/* Couche données — point d'entrée unique.
   Tout le reste du serveur passe par ici et ignore d'où viennent les données.
   C'est ce qui rend le remplacement de Notion possible sans toucher aux routes ni au front,
   et ce qui rendra possible un futur passage à Postgres si le projet devient un produit.

   Choix de la source dans .env :  SOURCE=sqlite  (défaut)  |  SOURCE=notion
   `notion` ne sert plus qu'à la migration et de filet de secours. */
const SOURCE = (process.env.SOURCE || 'sqlite').toLowerCase();

const impl = SOURCE === 'notion' ? require('./notion') : require('./sqlite');

if (SOURCE === 'notion') console.log('⚠️  Source de données : NOTION (mode historique)');

module.exports = impl;
