\# CREDENTIALS — ORT Search Service



\## Où me connecter

\- \*\*GitHub (code source)\*\* : github.com/wizstreg/ort-search

\- \*\*Local API (dev)\*\* : http://localhost:3031

\- \*\*Netlify (site web ORT)\*\* : (ton site Netlify si déjà créé)



\## Mes comptes / users

\- \*\*GitHub\*\* : wizstreg

\- \*\*Nom affiché Git\*\* : Marc Sorci

\- \*\*Email Git\*\* : marcsorci@free.fr

\- \*\*Stockage des identifiants Git\*\* : Git Credential Manager (Windows)



\## Jetons et clés

\- \*\*GitHub PAT (si demandé en terminal)\*\* : créer dans  

&nbsp; GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic) → \*Generate new token\* (scope `repo`).  

&nbsp; ⚠️ \*\*Ne pas\*\* committer ce token. Le credential manager le retient.



\- \*\*GeoNames\*\* : `GEONAMES\_USERNAME=...` (créez un compte gratuit sur geonames.org)  

\- \*\*Wikidata SPARQL\*\* : pas de clé, endpoint public.  

\- \*\*Nominatim\*\* : pas de clé, mais \*\*mettre un User-Agent propre\*\* côté requêtes.



\## Variables d’environnement (.env)

\- `PORT=3031`

\- `GEONAMES\_USERNAME=ton\_user\_geonames`

\- autres variables si ajoutées dans `api-search.mjs`.



> Le fichier `.env` doit \*\*rester local\*\* (déjà ignoré par `.gitignore`).



\## Rappels Git

```bat

git add .

git commit -m "feat: ..."

git push



