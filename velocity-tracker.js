/**
 * Velocity Tracker - Récupère et calcule la vélocité par membre depuis Linear
 * Utilisé pour ajuster automatiquement les baselines d'estimation
 */

const { LinearClient } = require('@linear/sdk');
const fs = require('fs');
const path = require('path');

const BASELINES_FILE = path.join(__dirname, 'team-baselines.json');

class VelocityTracker {
  constructor(linearClient, teamId) {
    this.linear = linearClient;
    this.teamId = teamId;
  }

  /**
   * Récupère les cycles récents d'une équipe
   * @param {number} count - Nombre de cycles à récupérer
   */
  async getRecentCycles(count = 3) {
    const team = await this.linear.team(this.teamId);
    const cyclesConnection = await team.cycles({
      first: 20, // Récupérer assez de cycles pour avoir les N derniers terminés
    });

    const cycles = cyclesConnection.nodes;
    
    // Filtrer pour ne garder que les cycles terminés
    const now = new Date();
    const completedCycles = cycles
      .filter(c => new Date(c.endsAt) < now)
      // Trier par date de fin décroissante (les plus récents en premier)
      .sort((a, b) => new Date(b.endsAt) - new Date(a.endsAt));
    
    // Prendre les N derniers cycles terminés
    return completedCycles.slice(0, count);
  }

  /**
   * Récupère les issues terminées d'un cycle avec leurs estimates
   * @param {string} cycleId - ID du cycle
   */
  async getCycleCompletedIssues(cycleId) {
    const issues = await this.linear.issues({
      filter: {
        cycle: { id: { eq: cycleId } },
        state: { type: { eq: 'completed' } },
        estimate: { gt: 0 }
      },
      first: 100
    });

    return issues.nodes;
  }

  /**
   * Calcule la vélocité par membre pour un cycle
   * @param {string} cycleId - ID du cycle
   */
  async getCycleVelocityByMember(cycleId) {
    const issues = await this.getCycleCompletedIssues(cycleId);
    const velocityByMember = {};

    for (const issue of issues) {
      if (!issue.estimate) continue;

      const assignee = await issue.assignee;
      if (!assignee) continue;

      const memberName = assignee.name || assignee.displayName || 'Unknown';
      const memberId = assignee.id;

      if (!velocityByMember[memberId]) {
        velocityByMember[memberId] = {
          id: memberId,
          name: memberName,
          totalPoints: 0,
          issueCount: 0,
          issues: []
        };
      }

      velocityByMember[memberId].totalPoints += issue.estimate;
      velocityByMember[memberId].issueCount += 1;
      velocityByMember[memberId].issues.push({
        identifier: issue.identifier,
        title: issue.title,
        estimate: issue.estimate
      });
    }

    return velocityByMember;
  }

  /**
   * Calcule la vélocité moyenne sur les N derniers cycles
   * @param {number} cycleCount - Nombre de cycles à analyser
   */
  async calculateAverageVelocity(cycleCount = 3) {
    console.log(`\n📊 Récupération des ${cycleCount} derniers cycles...`);
    
    const cycles = await this.getRecentCycles(cycleCount);
    
    if (cycles.length === 0) {
      console.log('❌ Aucun cycle terminé trouvé');
      return null;
    }

    console.log(`✅ ${cycles.length} cycle(s) trouvé(s):`);
    cycles.forEach(c => {
      console.log(`   - ${c.name || c.number}: ${new Date(c.startsAt).toLocaleDateString()} → ${new Date(c.endsAt).toLocaleDateString()}`);
    });

    // Agréger la vélocité de tous les cycles
    const aggregatedVelocity = {};
    const cycleDetails = [];

    for (const cycle of cycles) {
      console.log(`\n🔄 Analyse du cycle ${cycle.name || cycle.number}...`);
      
      const cycleVelocity = await this.getCycleVelocityByMember(cycle.id);
      
      cycleDetails.push({
        id: cycle.id,
        name: cycle.name || `Cycle ${cycle.number}`,
        number: cycle.number,
        startsAt: cycle.startsAt,
        endsAt: cycle.endsAt,
        velocityByMember: cycleVelocity
      });

      // Agréger
      for (const [memberId, data] of Object.entries(cycleVelocity)) {
        if (!aggregatedVelocity[memberId]) {
          aggregatedVelocity[memberId] = {
            id: memberId,
            name: data.name,
            cyclePoints: [],
            totalPoints: 0,
            totalIssues: 0
          };
        }
        
        aggregatedVelocity[memberId].cyclePoints.push({
          cycleName: cycle.name || `Cycle ${cycle.number}`,
          points: data.totalPoints,
          issues: data.issueCount
        });
        aggregatedVelocity[memberId].totalPoints += data.totalPoints;
        aggregatedVelocity[memberId].totalIssues += data.issueCount;
      }
    }

    // Calculer les moyennes et baselines recommandées
    const memberStats = [];
    
    for (const [memberId, data] of Object.entries(aggregatedVelocity)) {
      const cycleCount = data.cyclePoints.length;
      const avgPointsPerCycle = data.totalPoints / cycleCount;
      const avgIssuesPerCycle = data.totalIssues / cycleCount;
      const avgPointsPerIssue = data.totalIssues > 0 ? data.totalPoints / data.totalIssues : 0;
      
      // Calculer la baseline recommandée (points moyens par issue, arrondi Fibonacci)
      const recommendedBaseline = this.calculateRecommendedBaseline(avgPointsPerIssue, avgPointsPerCycle);
      
      memberStats.push({
        id: memberId,
        name: data.name,
        cyclePoints: data.cyclePoints,
        totalPoints: data.totalPoints,
        totalIssues: data.totalIssues,
        avgPointsPerCycle: Math.round(avgPointsPerCycle * 10) / 10,
        avgIssuesPerCycle: Math.round(avgIssuesPerCycle * 10) / 10,
        avgPointsPerIssue: Math.round(avgPointsPerIssue * 10) / 10,
        recommendedBaseline
      });
    }

    // Trier par vélocité moyenne décroissante
    memberStats.sort((a, b) => b.avgPointsPerCycle - a.avgPointsPerCycle);

    return {
      cycleCount: cycles.length,
      cycles: cycleDetails,
      memberStats,
      generatedAt: new Date().toISOString()
    };
  }

  /**
   * Calcule la baseline recommandée basée sur la vélocité
   * @param {number} avgPointsPerIssue - Points moyens par issue
   * @param {number} avgPointsPerCycle - Points moyens par cycle
   */
  calculateRecommendedBaseline(avgPointsPerIssue, avgPointsPerCycle) {
    // Fibonacci scale
    const fibonacci = [1, 2, 3, 5, 8, 13];
    
    // La baseline représente la taille "typique" d'une tâche pour cette personne
    // On utilise la moyenne des points par issue, arrondie à Fibonacci
    let baseline = avgPointsPerIssue;
    
    // Ajustement: si vélocité très haute (>25 pts/cycle), les tâches sont généralement petites
    if (avgPointsPerCycle > 25) {
      baseline = Math.min(baseline, 2);
    }
    // Si vélocité basse (<10 pts/cycle), les tâches sont généralement plus grosses
    else if (avgPointsPerCycle < 10) {
      baseline = Math.max(baseline, 3);
    }

    // Arrondir à la valeur Fibonacci la plus proche
    let closest = fibonacci[0];
    let minDiff = Math.abs(baseline - closest);
    
    for (const fib of fibonacci) {
      const diff = Math.abs(baseline - fib);
      if (diff < minDiff) {
        minDiff = diff;
        closest = fib;
      }
    }

    // Limiter entre 1 et 5 pour les baselines (pas 8 ou 13)
    return Math.max(1, Math.min(5, closest));
  }

  /**
   * Génère et sauvegarde le fichier de baselines
   */
  async updateBaselinesFile(cycleCount = 3) {
    const velocityData = await this.calculateAverageVelocity(cycleCount);
    
    if (!velocityData) {
      console.log('❌ Impossible de calculer les baselines');
      return null;
    }

    // Construire le fichier de baselines
    const baselines = {
      _meta: {
        generatedAt: velocityData.generatedAt,
        cyclesAnalyzed: velocityData.cycleCount,
        cycles: velocityData.cycles.map(c => ({
          name: c.name,
          period: `${new Date(c.startsAt).toLocaleDateString()} → ${new Date(c.endsAt).toLocaleDateString()}`
        }))
      },
      members: {}
    };

    for (const member of velocityData.memberStats) {
      // Normaliser le nom pour la clé (minuscule, premier mot)
      const key = member.name.toLowerCase().split(' ')[0];
      
      baselines.members[key] = {
        id: member.id,
        fullName: member.name,
        baseline: member.recommendedBaseline,
        stats: {
          avgPointsPerCycle: member.avgPointsPerCycle,
          avgIssuesPerCycle: member.avgIssuesPerCycle,
          avgPointsPerIssue: member.avgPointsPerIssue,
          cycleBreakdown: member.cyclePoints
        }
      };
    }

    // Sauvegarder
    fs.writeFileSync(BASELINES_FILE, JSON.stringify(baselines, null, 2));
    console.log(`\n✅ Baselines sauvegardées dans ${BASELINES_FILE}`);

    return baselines;
  }

  /**
   * Affiche un rapport de vélocité
   */
  async printVelocityReport(cycleCount = 3) {
    const data = await this.calculateAverageVelocity(cycleCount);
    
    if (!data) return;

    console.log('\n' + '='.repeat(80));
    console.log('📊 RAPPORT DE VÉLOCITÉ - ' + data.cycleCount + ' DERNIERS CYCLES');
    console.log('='.repeat(80));

    // Tableau par membre
    console.log('\n| Membre | Vélocité/Cycle | Issues/Cycle | Pts/Issue | Baseline |');
    console.log('|--------|----------------|--------------|-----------|----------|');
    
    for (const member of data.memberStats) {
      const name = member.name.padEnd(6).substring(0, 6);
      const vel = `${member.avgPointsPerCycle} pts`.padEnd(14);
      const issues = `${member.avgIssuesPerCycle}`.padEnd(12);
      const ptsPerIssue = `${member.avgPointsPerIssue}`.padEnd(9);
      const baseline = `${member.recommendedBaseline} pts`.padEnd(8);
      
      console.log(`| ${name} | ${vel} | ${issues} | ${ptsPerIssue} | ${baseline} |`);
    }

    // Détail par cycle
    console.log('\n📅 Détail par cycle:');
    for (const member of data.memberStats) {
      console.log(`\n   ${member.name}:`);
      for (const cycle of member.cyclePoints) {
        console.log(`     - ${cycle.cycleName}: ${cycle.points} pts (${cycle.issues} issues)`);
      }
    }

    console.log('\n' + '='.repeat(80));
  }
}

/**
 * Charge les baselines depuis le fichier ou retourne les valeurs par défaut
 */
function loadBaselines() {
  try {
    if (fs.existsSync(BASELINES_FILE)) {
      const content = fs.readFileSync(BASELINES_FILE, 'utf8');
      return JSON.parse(content);
    }
  } catch (error) {
    console.error('Erreur chargement baselines:', error.message);
  }
  
  return null;
}

/**
 * Obtient la baseline d'un membre par son nom
 */
function getMemberBaseline(memberName, defaultBaseline = 3) {
  const baselines = loadBaselines();
  
  if (!baselines || !baselines.members) {
    return { baseline: defaultBaseline, source: 'default' };
  }

  const normalizedName = memberName.toLowerCase().trim();
  
  // Chercher par clé ou nom complet
  for (const [key, data] of Object.entries(baselines.members)) {
    if (normalizedName.includes(key) || 
        key.includes(normalizedName) ||
        data.fullName?.toLowerCase().includes(normalizedName)) {
      return {
        baseline: data.baseline,
        source: 'calculated',
        stats: data.stats,
        generatedAt: baselines._meta?.generatedAt
      };
    }
  }

  return { baseline: defaultBaseline, source: 'default' };
}

module.exports = {
  VelocityTracker,
  loadBaselines,
  getMemberBaseline,
  BASELINES_FILE
};

// Si exécuté directement
if (require.main === module) {
  require('dotenv').config();
  
  async function main() {
    const apiKey = process.env.LINEAR_API_KEY;
    const teamId = process.env.DEV_TEAM_ID;

    if (!apiKey || apiKey === 'your_linear_api_key_here') {
      console.log('❌ LINEAR_API_KEY non configuré dans .env');
      process.exit(1);
    }

    if (!teamId || teamId === 'your_dev_team_id') {
      console.log('❌ DEV_TEAM_ID non configuré dans .env');
      process.exit(1);
    }

    const linear = new LinearClient({ apiKey });
    const tracker = new VelocityTracker(linear, teamId);

    const args = process.argv.slice(2);
    const cycleCount = parseInt(args[0]) || 3;

    if (args.includes('--update') || args.includes('-u')) {
      // Mettre à jour le fichier de baselines
      await tracker.updateBaselinesFile(cycleCount);
    } else {
      // Afficher le rapport seulement
      await tracker.printVelocityReport(cycleCount);
    }
  }

  main().catch(console.error);
}
