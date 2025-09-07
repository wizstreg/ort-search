// api-search.mjs
import http from 'http';
import { URL } from 'url';

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 3031);
const WDQS = 'https://query.wikidata.org/sparql';
const UA   = 'OneRoadTrip/Search/2.2 (+local; no-auth)';
const LANGS = ['fr','en','it','es','pt','ar']; // langues de recherche

function cors(res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','content-type');
  res.setHeader('Access-Control-Max-Age','86400');
}
function send(res, code, obj){
  cors(res);
  res.writeHead(code, {'Content-Type':'application/json; charset=utf-8'});
  res.end(JSON.stringify(obj));
}
const esc = s => String(s??'').replace(/["\\]/g, m=> m==='"'? '\\"':'\\\\');
const qid = uri => String(uri||'').split('/').pop();

async function wdFetch(query, timeoutMs=8000, preferPost=true){
  const ctl = new AbortController();
  const timer = setTimeout(()=>ctl.abort(new Error('timeout')), timeoutMs);
  const url = preferPost ? `${WDQS}?format=json`
                         : `${WDQS}?format=json&query=${encodeURIComponent(query)}`;
  try{
    const r = await fetch(url,{
      method: preferPost? 'POST':'GET',
      headers: {
        'Accept':'application/sparql-results+json',
        ...(preferPost? {'Content-Type':'application/sparql-query'}:{}),
        'User-Agent': UA
      },
      body: preferPost? query: undefined,
      signal: ctl.signal
    });
    clearTimeout(timer);
    if(!r.ok) throw new Error(`WDQS ${r.status}`);
    return await r.json();
  }catch(e){ clearTimeout(timer); throw e; }
}

/** Parse "Point(long lat)" -> {lat, lon} */
function parseWKTPoint(wkt){
  // expected like: "Point(13.405 52.52)"  => lon lat
  const m = /Point\(([-\d.]+)\s+([-\d.]+)\)/.exec(String(wkt||''));
  if(!m) return null;
  const lon = Number(m[1]), lat = Number(m[2]);
  if(Number.isFinite(lat) && Number.isFinite(lon)) return {lat, lon};
  return null;
}

/* ===================== COUNTRYSEARCH ===================== */
/**
 * GET /countrysearch?q=fr&lang=fr&limit=10
 * - match ISO2 exact (P297) si q=2 lettres
 * - sinon, labels & alias prefix (6 langues)
 * - instance of country (Q6256) (pays souverain)
 * - tri: iso-hit desc, prefix label/alias desc, sitelinks desc
 * - format: {items:[{name,countryCode,admin1:"",lat,lon,displayName}]}
 */
async function countrySearch(q, lang='fr', limit=12){
  const qTrim = (q||'').trim();
  if(!qTrim) return {items:[]};
  const qLower = qTrim.toLowerCase();
  const qUpper = qTrim.toUpperCase();
  const langsList = LANGS.map(l=> `"${l}"`).join(',');

  const query = `
        SELECT DISTINCT ?c ?cLabel ?iso2 ?sitelinks WHERE {
      ?c wdt:P31/wdt:P279* wd:Q6256 .                           # pays souverain
      OPTIONAL { ?c wdt:P297 ?iso2 }

      # hits prefix sur label/alias dans nos langues
      OPTIONAL {
        ?c rdfs:label ?lab .
        FILTER(LANG(?lab) IN (${langsList}))
        FILTER(STRSTARTS(LCASE(?lab), LCASE("${esc(qTrim)}")))
      }
      OPTIONAL {
        ?c skos:altLabel ?al .
        FILTER(LANG(?al) IN (${langsList}))
        FILTER(STRSTARTS(LCASE(?al), LCASE("${esc(qTrim)}")))
      }

      # au moins un des critères
      FILTER(
        (BOUND(?iso2) && UCASE(?iso2)="${esc(qUpper)}") ||
        BOUND(?lab) || BOUND(?al)
      )
      ?c wikibase:sitelinks ?sitelinks .
      SERVICE wikibase:label { bd:serviceParam wikibase:language "${lang},${LANGS.join(',')}" }
    }
  `;
const j = await wdFetch(query, 15000, true).catch(()=>null);
  const rows = j?.results?.bindings || [];
  if(!rows.length) return {items:[]};

  const sc = rows.map(r=>{
    const iso2 = r.iso2?.value || '';
    const wIso = iso2 && iso2.toUpperCase()===qUpper ? 1 : 0;
    const wPref = 1; // on a déjà filtré prefix via OPTIONAL+BOUND(?lab/?al)
    const sitelinks = Number(r.sitelinks?.value||0);
    return {
      id: qid(r.c.value),
      name: r.cLabel?.value || (iso2 || 'Country'),
      countryCode: iso2 || '',
      displayName: r.cLabel?.value || (iso2 || 'Country'),
      wIso, wPref, sitelinks
    };
  });

  sc.sort((a,b)=>{
    if(b.wIso !== a.wIso) return b.wIso - a.wIso;
    if(b.wPref!== a.wPref) return b.wPref- a.wPref;
    if(b.sitelinks!==a.sitelinks) return b.sitelinks - a.sitelinks;
    return a.name.localeCompare(b.name);
  });

  const items = sc.slice(0, limit).map(x=>({
    name: x.name,
    countryCode: x.countryCode,   // ISO2
    admin1: "",                   // placeholder pour compat
    lat: null, lon: null,         // pas utile ici
    displayName: x.displayName
  }));
  return {items};
}

/* ======================= CITYSEARCH (MWAPI) ====================== */
/**
 * GET /citysearch?q=toul&country=FR&lang=fr&limit=12
 * - Recherche préfixe via wikibase:mwapi (EntitySearch) -> rapide et fiable
 * - Filtrée ensuite: type ville/commune/lieu habité + coordonnées + pays ISO2 (si fourni)
 * - Tri: population desc puis nom court
 * - AUCUN fallback mondial si "country" est fourni
 */
async function citySearch(q, countryISO2 = '', lang = 'fr', limit = 12) {
  const qTrim = (q || '').trim();
  if (!qTrim) return { items: [] };

  const cc = (countryISO2 || '').toUpperCase();
  const langsPref = ['fr','en','es','it','pt','ar']; // mêmes langues que le front

  // SPARQL via wikibase:mwapi (EntitySearch) pour matcher par préfixe,
  // puis filtrage par classes + coordonnées + pays si fourni.
  const sparql = `
    PREFIX wd: <http://www.wikidata.org/entity/>
    PREFIX wdt: <http://www.wikidata.org/prop/direct/>
    PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
    PREFIX wikibase: <http://wikiba.se/ontology#>
    PREFIX bd: <http://www.bigdata.com/rdf#>
    PREFIX mwapi: <https://www.mediawiki.org/ontology#API/>

    SELECT ?it ?itLabel ?coord ?pop ?cIso WHERE {
      # 1) Recherche préfixe ultra-rapide
      SERVICE wikibase:mwapi {
        bd:serviceParam wikibase:endpoint "www.wikidata.org" .
        bd:serviceParam wikibase:api "EntitySearch" .
        bd:serviceParam mwapi:search "${esc(qTrim)}" .
        bd:serviceParam mwapi:language "${lang}" .
        bd:serviceParam mwapi:limit "50" .
        ?it wikibase:apiOutputItem mwapi:item .
      }

      # 2) Contraintes "ville"
      VALUES ?cls { wd:Q486972 wd:Q515 wd:Q5119 wd:Q15284 }  # lieu habité, ville, capitale, commune
      ?it wdt:P31/wdt:P279* ?cls .
      ?it wdt:P625 ?coord .                               # coordonnées obligatoires

      # 3) Pays (uniquement si fourni)
      ${cc ? `
        ?it (wdt:P17|wdt:P131*/wdt:P17) ?country .
        ?country wdt:P297 "${esc(cc)}" .
      ` : ''}

      OPTIONAL { ?it wdt:P1082 ?pop . }                  # population
      OPTIONAL {
        ?it (wdt:P17|wdt:P131*/wdt:P17) ?c2 .
        ?c2 wdt:P297 ?cIso .
      }

      SERVICE wikibase:label { bd:serviceParam wikibase:language "${lang},${langsPref.join(',')}" }
    }
    ORDER BY DESC(?pop) STRLEN(STR(?itLabel))
    LIMIT ${Math.max(1, Math.min(50, Number(limit || 12)))}
  `;

  let rows = [];
  const t0 = Date.now();
  try {
    const j = await wdFetch(sparql, 15000); // 15s max
    rows = j?.results?.bindings || [];
  } catch (e) {
    console.error('CITYSEARCH wdqs error:', String(e));
    return { items: [] };
  } finally {
    console.log(`CITYSEARCH q="${qTrim}" country="${cc}" -> ${rows.length} items in ${Date.now()-t0}ms`);
  }

  if (!rows.length) return { items: [] };

  // Normalisation + dédoublonnage
  const seen = new Set();
  const items = [];
  for (const r of rows) {
    const p = parseWKTPoint(r.coord?.value);
    const name = r.itLabel?.value || qTrim;
    const cIso = (r.cIso?.value || cc || '').toUpperCase();
    const key = `${name}|${cIso}|${p?.lat}|${p?.lon}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      name,
      displayName: name,
      countryCode: cIso,
      admin1: '',
      lat: p?.lat ?? null,
      lon: p?.lon ?? null
    });
    if (items.length >= limit) break;
  }
  return { items };
}

/* ========================= SERVER ======================== */
const server = http.createServer(async (req,res)=>{
  try{
    const u = new URL(req.url, `http://${req.headers.host}`);
    if(req.method==='OPTIONS'){ cors(res); res.writeHead(204); return res.end(); }

    if(u.pathname==='/ping'){
      return send(res,200,{ ok:true, api:'search', endpoints:['/countrysearch','/citysearch'] });
    }

    if(u.pathname==='/countrysearch' && req.method==='GET'){
      const q = u.searchParams.get('q') || '';
      const lang = u.searchParams.get('lang') || 'fr';
      const limit = Math.max(1, Math.min(30, Number(u.searchParams.get('limit')||12)));
      const out = await countrySearch(q, lang, limit).catch(()=>({items:[]}));
      return send(res,200,out);
    }

    if(u.pathname==='/citysearch' && req.method==='GET'){
      const q = u.searchParams.get('q') || u.searchParams.get('query') || ''; // compat
      const country = (u.searchParams.get('country')||u.searchParams.get('countryCode')||'').toUpperCase();
      const lang = u.searchParams.get('lang') || 'fr';
      const limit = Math.max(1, Math.min(30, Number(u.searchParams.get('limit')||12)));
      const out = await citySearch(q, country, lang, limit).catch(()=>({items:[]}));
      return send(res,200,out);
    }

    return send(res,404,{ error:'not_found' });
  }catch(e){
    return send(res,500,{ error:'server_error', detail:String(e) });
  }
});

server.listen(PORT, HOST, ()=>{
  console.log(`SEARCH API ON -> http://${HOST}:${PORT}  (/countrysearch, /citysearch)`);
});
