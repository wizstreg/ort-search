# ORT Search Service



\# ORT Search Service



Service Node.js pour la recherche OneRoadTrip (mini-API).



\- \*\*Langage\*\*: Node 22+

\- \*\*Entrée\*\*: requêtes HTTP

\- \*\*Sortie\*\*: JSON normalisé `{ ok, data, error }` (à généraliser)



---



\## Démarrer



```bash

npm i

node api-search.mjs

\# ou avec un port spécifique

\#  Windows (PowerShell) :  $env:PORT=3031; node api-search.mjs

\#  Windows (CMD)        :  set PORT=3031 \&\& node api-search.mjs



