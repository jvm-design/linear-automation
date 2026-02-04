/**
 * Script de test pour l'estimation automatique
 * Usage: npm run test:estimate
 */

const { calculateEstimate, TSHIRT_TO_POINTS, ASSIGNEE_BASELINES } = require('./estimation-config');

// Cas de test basés sur les exemples historiques
const testCases = [
  {
    name: 'Bug CSS simple - Seb',
    issue: {
      title: 'Fix z-index user menu',
      description: 'Le menu utilisateur apparaît derrière le header',
      assigneeName: 'Seb',
      labels: [{ name: 'BUG' }, { name: 'FRONT' }]
    },
    expectedRange: [1, 2] // XS ou S
  },
  {
    name: 'Feature IA - Lucien',
    issue: {
      title: 'Détourage v2 avec nouveau modèle',
      description: 'Implémenter la nouvelle version du détourage avec le modèle amélioré. Inclut les tests et la validation.',
      assigneeName: 'Lucien',
      labels: [{ name: 'IA' }, { name: 'Feature' }]
    },
    expectedRange: [5, 8] // L ou XL
  },
  {
    name: 'Migration infrastructure - Kevin',
    issue: {
      title: 'Migration Pulumi vers nouveau provider',
      description: 'Migration de l\'infrastructure vers le nouveau provider AWS avec mise à jour des stacks.',
      assigneeName: 'Kevin',
      labels: [{ name: 'BACK' }, { name: 'Infrastructure' }]
    },
    expectedRange: [5, 8] // L ou XL
  },
  {
    name: 'Animation Flutter - Panegna',
    issue: {
      title: 'Animation Shutter lors de la capture',
      description: 'Ajouter une animation de shutter fluide lors de la prise de photo.',
      assigneeName: 'Panegna',
      labels: [{ name: 'FRONT' }, { name: 'Mobile' }]
    },
    expectedRange: [3, 5] // M ou L
  },
  {
    name: 'Traduction - Override XS',
    issue: {
      title: 'Traduction manquante page settings',
      description: 'Ajouter les traductions FR/EN pour la nouvelle page settings',
      assigneeName: 'Seb',
      labels: [{ name: 'FRONT' }]
    },
    expectedRange: [1, 1] // XS obligatoire
  },
  {
    name: 'Issue sans assigné',
    issue: {
      title: 'Nouvelle feature API',
      description: 'Implémenter un nouvel endpoint pour la gestion des utilisateurs',
      assigneeName: null,
      labels: [{ name: 'BACK' }, { name: 'API' }]
    },
    expectedRange: [3, 5] // M ou L (default baseline)
  },
  {
    name: 'Refactoring majeur',
    issue: {
      title: 'Refactor du système d\'authentification',
      description: 'Refactoring complet du système auth avec migration vers JWT et mise à jour de la sécurité.',
      assigneeName: 'Kevin',
      labels: [{ name: 'BACK' }, { name: 'Security' }]
    },
    expectedRange: [8, 13] // XL ou XXL
  },
  {
    name: 'Hotfix rapide',
    issue: {
      title: 'Hotfix: correction typo bouton submit',
      description: 'Corriger la typo dans le bouton de soumission',
      assigneeName: 'Seb',
      labels: [{ name: 'BUG' }, { name: 'Hotfix' }]
    },
    expectedRange: [1, 1] // XS
  }
];

console.log('🧪 Test de l\'estimation automatique\n');
console.log('='.repeat(80));

// Afficher la configuration
console.log('\n📊 Configuration des baselines:\n');
console.log('| Assigné | Baseline | Domaine |');
console.log('|---------|----------|---------|');
Object.entries(ASSIGNEE_BASELINES)
  .filter(([k]) => k !== 'default')
  .forEach(([name, config]) => {
    console.log(`| ${name.padEnd(7)} | ${String(config.baseline).padEnd(8)} | ${config.domain.padEnd(7)} |`);
  });

console.log('\n📐 Échelle T-Shirt → Points:\n');
Object.entries(TSHIRT_TO_POINTS).forEach(([size, pts]) => {
  console.log(`   ${size.padEnd(3)} = ${pts} pts`);
});

console.log('\n' + '='.repeat(80));
console.log('\n🔬 Exécution des tests:\n');

let passed = 0;
let failed = 0;

testCases.forEach((testCase, index) => {
  const result = calculateEstimate(testCase.issue);
  const inRange = result.estimate >= testCase.expectedRange[0] && result.estimate <= testCase.expectedRange[1];
  
  const status = inRange ? '✅' : '❌';
  if (inRange) passed++; else failed++;

  console.log(`${status} Test ${index + 1}: ${testCase.name}`);
  console.log(`   Issue: "${testCase.issue.title}"`);
  console.log(`   Assigné: ${testCase.issue.assigneeName || 'Non assigné'}`);
  console.log(`   Labels: ${testCase.issue.labels.map(l => l.name).join(', ')}`);
  console.log(`   Estimation: ${result.estimate} pts (${result.tshirtSize}) - Confiance: ${result.confidence}%`);
  console.log(`   Attendu: ${testCase.expectedRange[0]}-${testCase.expectedRange[1]} pts`);
  console.log(`   Breakdown:`);
  console.log(`     - Baseline: ${result.breakdown.baseline}`);
  console.log(`     - Modif labels: ${result.breakdown.labelModifiers.modifier > 0 ? '+' : ''}${result.breakdown.labelModifiers.modifier}`);
  console.log(`     - Modif keywords: ${result.breakdown.keywordModifiers.modifier > 0 ? '+' : ''}${result.breakdown.keywordModifiers.modifier}`);
  console.log('');
});

console.log('='.repeat(80));
console.log(`\n📈 Résultats: ${passed}/${testCases.length} tests passés`);

if (failed > 0) {
  console.log(`⚠️  ${failed} test(s) échoué(s) - vérifier la configuration`);
  process.exit(1);
} else {
  console.log('🎉 Tous les tests sont passés!');
}

// Test de l'API preview si le serveur est lancé
console.log('\n💡 Pour tester l\'API preview:');
console.log('   curl -X POST http://localhost:3000/api/estimate/preview \\');
console.log('     -H "Content-Type: application/json" \\');
console.log('     -d \'{"title": "Fix bug header", "assigneeName": "Seb", "labels": ["BUG"]}\'');
