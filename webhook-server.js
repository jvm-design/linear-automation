const express = require('express');
const { LinearClient } = require('@linear/sdk');
const EstimationService = require('./estimation-service');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Initialize Linear client
const linearClient = new LinearClient({
  apiKey: process.env.LINEAR_API_KEY
});

// Initialize Estimation Service
const estimationService = new EstimationService(
  linearClient,
  process.env.ANTHROPIC_API_KEY
);

// Middleware
app.use(express.json());

// Store team IDs (you'll need to configure these)
const PRODUCT_DESIGN_TEAM_ID = process.env.PRODUCT_DESIGN_TEAM_ID;
const DEV_TEAM_ID = process.env.DEV_TEAM_ID;

// Teams où l'auto-estimation est activée (par défaut: DEV team seulement)
const AUTO_ESTIMATE_TEAM_IDS = (process.env.AUTO_ESTIMATE_TEAM_IDS || DEV_TEAM_ID)
  .split(',')
  .map(id => id.trim())
  .filter(Boolean);

// ==========================================
// WEBHOOK: Auto-estimation des nouvelles issues
// ==========================================
app.post('/webhook/estimate', async (req, res) => {
  // Répondre immédiatement pour éviter les timeouts Linear (3s max)
  res.status(200).send('OK');

  try {
    const { action, type, data } = req.body;
    
    console.log(`[Webhook Estimate] Reçu: type=${type}, action=${action}, team=${data?.teamId}`);

    // Ne traiter que les créations d'issues
    if (type !== 'Issue' || action !== 'create') {
      console.log('[Webhook Estimate] Ignoré: pas une création d\'issue');
      return;
    }

    // Vérifier si l'équipe est éligible à l'auto-estimation
    if (!AUTO_ESTIMATE_TEAM_IDS.includes(data.teamId)) {
      console.log(`[Webhook Estimate] Ignoré: équipe ${data.teamId} non configurée pour l'auto-estimation`);
      return;
    }

    // Lancer l'estimation en arrière-plan
    console.log(`[Webhook Estimate] Démarrage estimation pour issue ${data.identifier || data.id}`);
    
    const result = await estimationService.estimateAndUpdateIssue(req.body);
    
    if (result.success) {
      if (result.skipped) {
        console.log(`[Webhook Estimate] Issue ${data.identifier} ignorée: ${result.reason}`);
      } else {
        console.log(`[Webhook Estimate] ✅ Issue ${result.identifier} estimée: ${result.estimate} pts (${result.tshirtSize})`);
      }
    } else {
      console.error(`[Webhook Estimate] ❌ Erreur:`, result.error);
    }

  } catch (error) {
    console.error('[Webhook Estimate] Erreur inattendue:', error);
  }
});

// ==========================================
// WEBHOOK: Transfert Product Design → DEV
// ==========================================
app.post('/webhook/linear', async (req, res) => {
  try {
    const { action, type, data, updatedFrom } = req.body;
    
    // Only process issue updates
    if (type !== 'Issue' || action !== 'update') {
      return res.status(200).send('OK');
    }

    // Check if this is from Product Design team
    if (data.teamId !== PRODUCT_DESIGN_TEAM_ID) {
      return res.status(200).send('OK');
    }

    // Check if status changed to "Done"
    const statusChanged = updatedFrom && updatedFrom.stateId !== data.stateId;
    
    if (statusChanged) {
      // Get the current state to check if it's "Done"
      const state = await linearClient.workflowState(data.stateId);
      
      if (state.name.toLowerCase() === 'done') {
        console.log(`Issue ${data.title} completed in Product Design team`);
        
        // Transfer issue to DEV team triage
        await transferIssueToDevTriage(data);
      }
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('Webhook processing error:', error);
    res.status(500).send('Internal Server Error');
  }
});

async function transferIssueToDevTriage(issueData) {
  try {
    // Get DEV team's triage state
    const devTeam = await linearClient.team(DEV_TEAM_ID);
    const devStates = await devTeam.states();
    const triageState = devStates.nodes.find(state => 
      state.name.toLowerCase().includes('triage') || 
      state.name.toLowerCase().includes('backlog')
    );

    if (!triageState) {
      throw new Error('Could not find triage/backlog state in DEV team');
    }

    // Create new issue in DEV team
    const newIssue = await linearClient.issueCreate({
      title: `[From Product Design] ${issueData.title}`,
      description: `Originally completed in Product Design team.\n\n${issueData.description || ''}`,
      teamId: DEV_TEAM_ID,
      stateId: triageState.id,
      priority: issueData.priority || 0,
      labels: issueData.labelIds || []
    });

    // Add comment to original issue
    await linearClient.commentCreate({
      issueId: issueData.id,
      body: `✅ This issue has been transferred to the DEV team for implementation: ${newIssue.issue?.identifier}`
    });

    console.log(`Issue transferred: ${issueData.identifier} → ${newIssue.issue?.identifier}`);
    
  } catch (error) {
    console.error('Error transferring issue:', error);
    throw error;
  }
}

// ==========================================
// API: Preview estimation (sans mise à jour)
// IMPORTANT: Cette route DOIT être avant /api/estimate/:issueId
// ==========================================
app.post('/api/estimate/preview', async (req, res) => {
  try {
    const { title, description, assigneeName, labels } = req.body;
    
    const { calculateEstimate } = require('./estimation-config');
    
    const estimate = calculateEstimate({
      title,
      description,
      assigneeName,
      labels: labels?.map(l => typeof l === 'string' ? { name: l } : l) || []
    });
    
    res.status(200).json({
      estimate: estimate.estimate,
      tshirtSize: estimate.tshirtSize,
      confidence: estimate.confidence,
      breakdown: estimate.breakdown
    });

  } catch (error) {
    console.error('[API Preview] Erreur:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// API: Estimation manuelle d'une issue
// ==========================================
app.post('/api/estimate/:issueId', async (req, res) => {
  try {
    const { issueId } = req.params;
    
    console.log(`[API Estimate] Estimation manuelle demandée pour: ${issueId}`);
    
    // Récupérer l'issue
    const issue = await linearClient.issue(issueId);
    if (!issue) {
      return res.status(404).json({ error: 'Issue not found' });
    }

    // Simuler les données webhook
    const webhookData = {
      action: 'create',
      type: 'Issue',
      data: {
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        description: issue.description,
        teamId: issue._team?.id
      }
    };

    const result = await estimationService.estimateAndUpdateIssue(webhookData);
    
    res.status(200).json(result);

  } catch (error) {
    console.error('[API Estimate] Erreur:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// API: Configuration actuelle
// ==========================================
app.get('/api/config', (req, res) => {
  const { getBaselines, LABEL_MODIFIERS, TSHIRT_TO_POINTS } = require('./estimation-config');
  const { loadBaselines } = require('./velocity-tracker');
  
  const baselines = getBaselines();
  const baselinesFile = loadBaselines();
  
  res.status(200).json({
    tshirtToPoints: TSHIRT_TO_POINTS,
    assigneeBaselines: Object.fromEntries(
      Object.entries(baselines).map(([k, v]) => [k, { 
        baseline: v.baseline, 
        domain: v.domain,
        avgVelocity: v.avgVelocity,
        source: v.source || 'default'
      }])
    ),
    labelModifiers: LABEL_MODIFIERS,
    autoEstimateTeams: AUTO_ESTIMATE_TEAM_IDS,
    claudeEnabled: !!process.env.ANTHROPIC_API_KEY,
    baselinesLastUpdated: baselinesFile?._meta?.generatedAt || null,
    cyclesAnalyzed: baselinesFile?._meta?.cyclesAnalyzed || 0
  });
});

// ==========================================
// API: Rapport de vélocité
// ==========================================
app.get('/api/velocity', async (req, res) => {
  try {
    const { VelocityTracker } = require('./velocity-tracker');
    const cycleCount = parseInt(req.query.cycles) || 3;
    
    const tracker = new VelocityTracker(linearClient, DEV_TEAM_ID);
    const data = await tracker.calculateAverageVelocity(cycleCount);
    
    if (!data) {
      return res.status(404).json({ error: 'Aucun cycle terminé trouvé' });
    }
    
    res.status(200).json(data);

  } catch (error) {
    console.error('[API Velocity] Erreur:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// API: Mettre à jour les baselines
// ==========================================
app.post('/api/baselines/update', async (req, res) => {
  try {
    const { VelocityTracker } = require('./velocity-tracker');
    const { reloadBaselines } = require('./estimation-config');
    
    const cycleCount = parseInt(req.query.cycles) || 3;
    
    console.log(`[API Baselines] Mise à jour des baselines sur ${cycleCount} cycles...`);
    
    const tracker = new VelocityTracker(linearClient, DEV_TEAM_ID);
    const baselines = await tracker.updateBaselinesFile(cycleCount);
    
    if (!baselines) {
      return res.status(500).json({ error: 'Impossible de calculer les baselines' });
    }
    
    // Recharger les baselines dans la config
    reloadBaselines();
    
    res.status(200).json({
      success: true,
      message: `Baselines mises à jour sur ${baselines._meta.cyclesAnalyzed} cycles`,
      baselines: baselines.members,
      meta: baselines._meta
    });

  } catch (error) {
    console.error('[API Baselines] Erreur:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// API: Voir les baselines actuelles
// ==========================================
app.get('/api/baselines', (req, res) => {
  const { loadBaselines, BASELINES_FILE } = require('./velocity-tracker');
  const { getBaselines, DEFAULT_ASSIGNEE_BASELINES } = require('./estimation-config');
  
  const fileBaselines = loadBaselines();
  const activeBaselines = getBaselines();
  
  res.status(200).json({
    source: fileBaselines ? 'calculated' : 'default',
    file: BASELINES_FILE,
    lastUpdated: fileBaselines?._meta?.generatedAt || null,
    cyclesAnalyzed: fileBaselines?._meta?.cyclesAnalyzed || 0,
    cycles: fileBaselines?._meta?.cycles || [],
    members: fileBaselines?.members || null,
    activeBaselines: Object.fromEntries(
      Object.entries(activeBaselines)
        .filter(([k]) => k !== 'default')
        .map(([k, v]) => [k, {
          baseline: v.baseline,
          domain: v.domain,
          avgVelocity: v.avgVelocity
        }])
    ),
    defaults: DEFAULT_ASSIGNEE_BASELINES
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    features: {
      autoEstimation: true,
      claudeRefinement: !!process.env.ANTHROPIC_API_KEY,
      productDesignTransfer: !!PRODUCT_DESIGN_TEAM_ID
    }
  });
});

app.listen(port, () => {
  const { loadBaselines } = require('./velocity-tracker');
  const baselinesData = loadBaselines();
  
  console.log(`\n🚀 Linear webhook server running on port ${port}`);
  console.log(`\n📍 Endpoints disponibles:`);
  console.log(`   POST /webhook/estimate      - Auto-estimation (webhook Linear)`);
  console.log(`   POST /webhook/linear        - Transfert Product Design → DEV`);
  console.log(`   POST /api/estimate/:id      - Estimation manuelle d'une issue`);
  console.log(`   POST /api/estimate/preview  - Preview estimation (sans update)`);
  console.log(`   GET  /api/config            - Configuration actuelle`);
  console.log(`   GET  /api/velocity          - Rapport de vélocité`);
  console.log(`   GET  /api/baselines         - Baselines actuelles`);
  console.log(`   POST /api/baselines/update  - Recalculer les baselines`);
  console.log(`   GET  /health                - Health check`);
  console.log(`\n⚙️  Configuration:`);
  console.log(`   Claude refinement: ${process.env.ANTHROPIC_API_KEY ? '✅ Activé' : '❌ Désactivé'}`);
  console.log(`   Auto-estimate teams: ${AUTO_ESTIMATE_TEAM_IDS.length > 0 ? AUTO_ESTIMATE_TEAM_IDS.join(', ') : 'Non configuré'}`);
  
  if (baselinesData) {
    console.log(`\n📊 Baselines dynamiques:`);
    console.log(`   Dernière mise à jour: ${new Date(baselinesData._meta?.generatedAt).toLocaleString()}`);
    console.log(`   Cycles analysés: ${baselinesData._meta?.cyclesAnalyzed}`);
    const members = Object.entries(baselinesData.members || {});
    members.forEach(([name, data]) => {
      console.log(`   - ${data.fullName}: ${data.baseline} pts (${data.stats?.avgPointsPerCycle} pts/cycle)`);
    });
  } else {
    console.log(`\n📊 Baselines: utilisation des valeurs par défaut`);
    console.log(`   💡 Exécutez 'npm run baselines:update' pour calculer depuis Linear`);
  }
  console.log('');
});