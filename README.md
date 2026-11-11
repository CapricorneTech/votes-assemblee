# Votes de l'Assemblée

Site statique pour suivre les textes de loi examinés à l'Assemblée nationale et les votes de chaque groupe et de chaque député.

- Données : [open data de l'Assemblée nationale](https://data.assemblee-nationale.fr/) (Licence Ouverte).
- `node scripts/build-data.mjs` télécharge les données et génère `site/data/` (aucune dépendance).
- `npx serve site` pour prévisualiser en local.
- Le site est reconstruit et publié chaque jour par GitHub Actions (`.github/workflows/deploy.yml`).
