/**
 * Configuration de l'estimation automatique basée sur les données historiques
 * 
 * Les baselines peuvent être:
 * 1. Calculées automatiquement depuis les 3 derniers cycles (team-baselines.json)
 * 2. Définies manuellement ci-dessous (fallback)
 * 
 * Pour mettre à jour les baselines automatiquement:
 *   node velocity-tracker.js --update
 */

const fs = require('fs');
const path = require('path');

// Échelle Fibonacci utilisée dans Linear
const FIBONACCI_SCALE = [1, 2, 3, 5, 8, 13];

// Mapping tailles T-Shirt vers points
const TSHIRT_TO_POINTS = {
  'XS': 1,   // < 2h - Traductions, config simple, fix UI mineur
  'S': 2,    // 2-4h - Bug simple, ajout de champ, ajustement UI
  'M': 3,    // 0.5-1 jour - Feature moyenne, intégration API, tests E2E
  'L': 5,    // 1-2 jours - Feature complète, refactoring, intégration OCR
  'XL': 8,   // 2-4 jours - Système IA majeur, pipeline E2E complet
  'XXL': 13  // ~1 semaine - Architecture, migration majeure
};

// Baseline FALLBACK par assigné (utilisé si team-baselines.json n'existe pas)
// Ces valeurs sont remplacées par les données calculées si disponibles
const DEFAULT_ASSIGNEE_BASELINES = {
  'seb': { baseline: 2, domain: 'FRONT', avgVelocity: 23 },
  'sebastien': { baseline: 2, domain: 'FRONT', avgVelocity: 23 },
  'kevin': { baseline: 3, domain: 'BACK', avgVelocity: 16 },
  'lucien': { baseline: 5, domain: 'IA', avgVelocity: 10 },
  'panegna': { baseline: 3, domain: 'MOBILE', avgVelocity: 10 },
  'default': { baseline: 3, domain: 'UNKNOWN', avgVelocity: 15 }
};

// Mapping des domaines par membre (utilisé pour enrichir les données calculées)
const MEMBER_DOMAINS = {
  'seb': 'FRONT',
  'sebastien': 'FRONT',
  'kevin': 'BACK',
  'lucien': 'IA',
  'panegna': 'MOBILE'
};

/**
 * Charge les baselines dynamiques depuis team-baselines.json
 */
function loadDynamicBaselines() {
  const baselinesFile = path.join(__dirname, 'team-baselines.json');
  
  try {
    if (fs.existsSync(baselinesFile)) {
      const content = fs.readFileSync(baselinesFile, 'utf8');
      const data = JSON.parse(content);
      
      if (data.members) {
        const baselines = {};
        
        for (const [key, member] of Object.entries(data.members)) {
          baselines[key] = {
            baseline: member.baseline,
            domain: MEMBER_DOMAINS[key] || 'UNKNOWN',
            avgVelocity: member.stats?.avgPointsPerCycle || 15,
            source: 'calculated',
            lastUpdated: data._meta?.generatedAt
          };
        }
        
        // Ajouter le fallback default
        baselines['default'] = DEFAULT_ASSIGNEE_BASELINES['default'];
        
        return baselines;
      }
    }
  } catch (error) {
    console.warn('[Config] Erreur chargement baselines dynamiques:', error.message);
  }
  
  return null;
}

// Charger les baselines (dynamiques ou fallback)
let ASSIGNEE_BASELINES = loadDynamicBaselines() || DEFAULT_ASSIGNEE_BASELINES;

/**
 * Recharge les baselines depuis le fichier
 * Appelé après une mise à jour des baselines
 */
function reloadBaselines() {
  const newBaselines = loadDynamicBaselines();
  if (newBaselines) {
    ASSIGNEE_BASELINES = newBaselines;
    console.log('[Config] Baselines rechargées depuis team-baselines.json');
    return true;
  }
  return false;
}

/**
 * Retourne les baselines actuelles
 */
function getBaselines() {
  return ASSIGNEE_BASELINES;
}

// Modificateurs par label
const LABEL_MODIFIERS = {
  // Labels qui réduisent l'estimation
  'bug': -1,
  'fix': -1,
  'scaffolded': -1,
  'hotfix': -1,
  'quick-win': -1,
  'traduction': -2,  // Override vers XS
  'translation': -2,
  
  // Labels qui augmentent l'estimation
  'ia': 2,
  'ai': 2,
  'ml': 2,
  'migration': 2,
  'refactor': 2,
  'refactoring': 2,
  'architecture': 3,
  'security': 1,
  'performance': 1,
  'e2e': 1,
  'tests': 1,
  'integration': 1,
  'ocr': 2,
  'pipeline': 2
};

// Mots-clés dans le titre/description qui modifient l'estimation
// Note: Ces modificateurs sont ADDITIONNELS aux labels
// Éviter la duplication avec les labels (ex: si IA est un label, ne pas mettre 'ia' ici)
const KEYWORD_MODIFIERS = {
  // Mots-clés qui réduisent
  'typo': -1,
  'fix': -1,
  'hotfix': -2,
  'traduction': -2,
  'translation': -2,
  'config': -1,
  'env': -1,
  'z-index': -1,
  'css': -1,
  'style': -1,
  'padding': -1,
  'margin': -1,
  
  // Mots-clés qui augmentent (uniquement si pas déjà dans les labels)
  'migration': 2,
  'refactor': 2,
  'architecture': 3,
  'système': 1,
  'system': 1,
  'pipeline': 1,
  'auth': 1,
  'authentication': 1,
  'security': 1,
  'database': 1,
  // Note: 'api', 'ia', 'test' retirés car souvent redondants avec labels
  'intégration': 1,
  'integration': 1,
  'performance': 1,
  'optimisation': 1,
  'optimization': 1
};

/**
 * Trouve le profil de l'assigné basé sur son nom
 * Utilise les baselines dynamiques si disponibles
 */
function getAssigneeProfile(assigneeName) {
  // Toujours utiliser la version la plus récente des baselines
  const baselines = getBaselines();
  
  if (!assigneeName) return baselines.default || DEFAULT_ASSIGNEE_BASELINES.default;
  
  const normalizedName = assigneeName.toLowerCase().trim();
  
  for (const [key, profile] of Object.entries(baselines)) {
    if (key === 'default') continue;
    if (normalizedName.includes(key) || key.includes(normalizedName)) {
      return profile;
    }
  }
  
  return baselines.default || DEFAULT_ASSIGNEE_BASELINES.default;
}

/**
 * Calcule les modificateurs basés sur les labels
 */
function calculateLabelModifiers(labels) {
  if (!labels || !Array.isArray(labels)) return 0;
  
  let modifier = 0;
  const appliedModifiers = [];
  
  for (const label of labels) {
    const normalizedLabel = (label.name || label).toLowerCase().trim();
    
    for (const [key, mod] of Object.entries(LABEL_MODIFIERS)) {
      if (normalizedLabel.includes(key)) {
        modifier += mod;
        appliedModifiers.push({ label: normalizedLabel, modifier: mod });
        break; // Un seul modificateur par label
      }
    }
  }
  
  return { modifier, applied: appliedModifiers };
}

/**
 * Calcule les modificateurs basés sur les mots-clés du titre/description
 */
function calculateKeywordModifiers(title, description) {
  const text = `${title || ''} ${description || ''}`.toLowerCase();
  
  let modifier = 0;
  const appliedModifiers = [];
  const usedKeywords = new Set();
  
  for (const [keyword, mod] of Object.entries(KEYWORD_MODIFIERS)) {
    if (text.includes(keyword) && !usedKeywords.has(keyword)) {
      modifier += mod;
      appliedModifiers.push({ keyword, modifier: mod });
      usedKeywords.add(keyword);
    }
  }
  
  // Limiter les modificateurs de mots-clés pour éviter l'explosion
  const cappedModifier = Math.max(-3, Math.min(5, modifier));
  
  return { modifier: cappedModifier, applied: appliedModifiers };
}

/**
 * Arrondit vers la valeur Fibonacci la plus proche
 */
function roundToFibonacci(value) {
  // Trouver la valeur Fibonacci la plus proche
  let closest = FIBONACCI_SCALE[0];
  let minDiff = Math.abs(value - closest);
  
  for (const fib of FIBONACCI_SCALE) {
    const diff = Math.abs(value - fib);
    if (diff < minDiff) {
      minDiff = diff;
      closest = fib;
    }
  }
  
  return closest;
}

/**
 * Calcule l'estimation finale basée sur toutes les données
 * 
 * @param {Object} issueData - Les données de l'issue
 * @param {string} issueData.title - Titre de l'issue
 * @param {string} issueData.description - Description de l'issue
 * @param {string} issueData.assigneeName - Nom de l'assigné
 * @param {Array} issueData.labels - Labels de l'issue
 * @returns {Object} - Estimation et détails du calcul
 */
function calculateEstimate(issueData) {
  const { title, description, assigneeName, labels } = issueData;
  
  // 1. Obtenir le profil de l'assigné
  const assigneeProfile = getAssigneeProfile(assigneeName);
  const baselineEstimate = assigneeProfile.baseline;
  
  // 2. Calculer les modificateurs des labels
  const labelResult = calculateLabelModifiers(labels);
  
  // 3. Calculer les modificateurs des mots-clés
  const keywordResult = calculateKeywordModifiers(title, description);
  
  // 4. Calculer l'estimation brute
  const rawEstimate = baselineEstimate + labelResult.modifier + keywordResult.modifier;
  
  // 5. Clamp et arrondir à Fibonacci
  const clampedEstimate = Math.max(1, Math.min(13, rawEstimate));
  const finalEstimate = roundToFibonacci(clampedEstimate);
  
  // 6. Déterminer la taille T-Shirt
  const tshirtSize = Object.entries(TSHIRT_TO_POINTS)
    .find(([_, pts]) => pts === finalEstimate)?.[0] || 'M';
  
  return {
    estimate: finalEstimate,
    tshirtSize,
    confidence: calculateConfidence(labelResult, keywordResult, assigneeName),
    breakdown: {
      assignee: assigneeName || 'Non assigné',
      assigneeDomain: assigneeProfile.domain,
      baseline: baselineEstimate,
      labelModifiers: labelResult,
      keywordModifiers: keywordResult,
      rawEstimate,
      clampedEstimate,
      finalEstimate
    }
  };
}

/**
 * Calcule un score de confiance pour l'estimation
 */
function calculateConfidence(labelResult, keywordResult, assigneeName) {
  let confidence = 70; // Base
  
  // Plus de contexte = plus de confiance
  if (assigneeName) confidence += 10;
  if (labelResult.applied.length > 0) confidence += 10;
  if (keywordResult.applied.length > 0) confidence += 5;
  
  // Trop de modificateurs = moins de confiance (complexité)
  if (Math.abs(labelResult.modifier) + Math.abs(keywordResult.modifier) > 5) {
    confidence -= 15;
  }
  
  return Math.min(95, Math.max(40, confidence));
}

/**
 * Génère le prompt pour Claude pour affiner l'estimation
 */
function generateClaudePrompt(issueData, initialEstimate) {
  return `Tu es un expert en estimation de tâches de développement logiciel.

Analyse cette issue et valide ou ajuste l'estimation proposée.

## Issue
- **Titre**: ${issueData.title}
- **Description**: ${issueData.description || 'Pas de description'}
- **Assigné**: ${issueData.assigneeName || 'Non assigné'}
- **Labels**: ${issueData.labels?.map(l => l.name || l).join(', ') || 'Aucun'}

## Estimation automatique
- **Points proposés**: ${initialEstimate.estimate} (${initialEstimate.tshirtSize})
- **Confiance**: ${initialEstimate.confidence}%
- **Breakdown**:
  - Baseline assigné (${initialEstimate.breakdown.assigneeDomain}): ${initialEstimate.breakdown.baseline} pts
  - Modificateurs labels: ${initialEstimate.breakdown.labelModifiers.modifier > 0 ? '+' : ''}${initialEstimate.breakdown.labelModifiers.modifier}
  - Modificateurs mots-clés: ${initialEstimate.breakdown.keywordModifiers.modifier > 0 ? '+' : ''}${initialEstimate.breakdown.keywordModifiers.modifier}

## Échelle d'estimation
- 1 pt (XS): < 2h - Traductions, config simple, fix UI mineur
- 2 pts (S): 2-4h - Bug simple, ajout de champ, ajustement UI
- 3 pts (M): 0.5-1 jour - Feature moyenne, intégration API
- 5 pts (L): 1-2 jours - Feature complète, refactoring
- 8 pts (XL): 2-4 jours - Système majeur, pipeline complet
- 13 pts (XXL): ~1 semaine - Architecture, migration majeure

## Instructions
Réponds UNIQUEMENT avec un JSON valide (pas de markdown, pas de texte avant/après):
{
  "estimate": <number entre 1 et 13, valeur Fibonacci>,
  "confidence": <number entre 0 et 100>,
  "reasoning": "<explication courte en français, max 100 caractères>"
}`;
}

module.exports = {
  FIBONACCI_SCALE,
  TSHIRT_TO_POINTS,
  get ASSIGNEE_BASELINES() { return getBaselines(); },
  DEFAULT_ASSIGNEE_BASELINES,
  MEMBER_DOMAINS,
  LABEL_MODIFIERS,
  KEYWORD_MODIFIERS,
  getBaselines,
  reloadBaselines,
  getAssigneeProfile,
  calculateLabelModifiers,
  calculateKeywordModifiers,
  roundToFibonacci,
  calculateEstimate,
  calculateConfidence,
  generateClaudePrompt
};
