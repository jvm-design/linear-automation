/**
 * Service d'estimation automatique des issues Linear
 * Combine les règles basées sur les données historiques avec Claude pour la validation
 */

const Anthropic = require('@anthropic-ai/sdk');
const { 
  calculateEstimate, 
  generateClaudePrompt, 
  roundToFibonacci 
} = require('./estimation-config');

class EstimationService {
  constructor(linearClient, anthropicApiKey) {
    this.linearClient = linearClient;
    this.anthropic = anthropicApiKey ? new Anthropic({ apiKey: anthropicApiKey }) : null;
    this.useClaudeRefinement = !!anthropicApiKey;
  }

  /**
   * Estime une issue et met à jour Linear
   * @param {Object} webhookData - Données du webhook Linear
   * @returns {Object} - Résultat de l'estimation
   */
  async estimateAndUpdateIssue(webhookData) {
    const startTime = Date.now();
    
    try {
      // 1. Extraire les données de l'issue
      const issueData = await this.extractIssueData(webhookData);
      
      // 2. Ne pas estimer si déjà estimé
      if (issueData.currentEstimate && issueData.currentEstimate > 0) {
        console.log(`[Estimation] Issue ${issueData.identifier} déjà estimée: ${issueData.currentEstimate} pts`);
        return {
          success: true,
          skipped: true,
          reason: 'already_estimated',
          currentEstimate: issueData.currentEstimate
        };
      }

      // 3. Calculer l'estimation initiale basée sur les règles
      const initialEstimate = calculateEstimate(issueData);
      console.log(`[Estimation] ${issueData.identifier} - Estimation initiale: ${initialEstimate.estimate} pts (${initialEstimate.tshirtSize}), confiance: ${initialEstimate.confidence}%`);

      // 4. Affiner avec Claude si configuré et confiance < 80%
      let finalEstimate = initialEstimate;
      if (this.useClaudeRefinement && initialEstimate.confidence < 80) {
        try {
          finalEstimate = await this.refineWithClaude(issueData, initialEstimate);
          console.log(`[Estimation] ${issueData.identifier} - Estimation Claude: ${finalEstimate.estimate} pts, confiance: ${finalEstimate.confidence}%`);
        } catch (claudeError) {
          console.error(`[Estimation] Erreur Claude, utilisation estimation initiale:`, claudeError.message);
          // Continuer avec l'estimation initiale
        }
      }

      // 5. Mettre à jour l'issue dans Linear
      await this.updateIssueEstimate(issueData.id, finalEstimate.estimate);

      // 6. Ajouter un commentaire explicatif (optionnel)
      await this.addEstimationComment(issueData.id, finalEstimate, initialEstimate);

      const duration = Date.now() - startTime;
      console.log(`[Estimation] ${issueData.identifier} terminé en ${duration}ms`);

      return {
        success: true,
        issueId: issueData.id,
        identifier: issueData.identifier,
        estimate: finalEstimate.estimate,
        tshirtSize: finalEstimate.tshirtSize,
        confidence: finalEstimate.confidence,
        reasoning: finalEstimate.reasoning,
        usedClaude: finalEstimate !== initialEstimate,
        duration
      };

    } catch (error) {
      console.error('[Estimation] Erreur:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Extrait les données nécessaires de l'issue
   */
  async extractIssueData(webhookData) {
    const { data } = webhookData;
    
    // Récupérer l'issue complète pour avoir toutes les données
    const issue = await this.linearClient.issue(data.id);
    
    // Récupérer l'assigné si présent
    let assigneeName = null;
    if (issue.assignee) {
      const assignee = await issue.assignee;
      assigneeName = assignee?.name || assignee?.displayName;
    }

    // Récupérer les labels
    const labelsConnection = await issue.labels();
    const labels = labelsConnection?.nodes || [];

    return {
      id: data.id,
      identifier: data.identifier || issue.identifier,
      title: data.title || issue.title,
      description: data.description || issue.description,
      assigneeName,
      labels: labels.map(l => ({ name: l.name, color: l.color })),
      currentEstimate: issue.estimate,
      priority: issue.priority,
      teamId: data.teamId
    };
  }

  /**
   * Affine l'estimation avec Claude
   */
  async refineWithClaude(issueData, initialEstimate) {
    const prompt = generateClaudePrompt(issueData, initialEstimate);

    const response = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 256,
      messages: [
        { role: 'user', content: prompt }
      ]
    });

    const content = response.content[0]?.text?.trim();
    
    try {
      // Parser la réponse JSON
      const result = JSON.parse(content);
      
      // Valider et normaliser
      const estimate = roundToFibonacci(Math.max(1, Math.min(13, result.estimate || initialEstimate.estimate)));
      
      return {
        estimate,
        tshirtSize: this.getTshirtSize(estimate),
        confidence: Math.min(95, Math.max(40, result.confidence || 75)),
        reasoning: result.reasoning || 'Estimation affinée par Claude',
        breakdown: initialEstimate.breakdown,
        refinedByClaude: true
      };
    } catch (parseError) {
      console.error('[Estimation] Erreur parsing réponse Claude:', content);
      // Retourner l'estimation initiale si parsing échoue
      return initialEstimate;
    }
  }

  /**
   * Met à jour l'estimation dans Linear
   */
  async updateIssueEstimate(issueId, estimate) {
    await this.linearClient.issueUpdate(issueId, {
      estimate
    });
    console.log(`[Estimation] Issue ${issueId} mise à jour avec estimate: ${estimate}`);
  }

  /**
   * Ajoute un commentaire explicatif sur l'issue
   */
  async addEstimationComment(issueId, finalEstimate, initialEstimate) {
    const comment = this.formatEstimationComment(finalEstimate, initialEstimate);
    
    await this.linearClient.commentCreate({
      issueId,
      body: comment
    });
  }

  /**
   * Formate le commentaire d'estimation
   */
  formatEstimationComment(finalEstimate, initialEstimate) {
    const { breakdown } = initialEstimate;
    
    let comment = `🤖 **Estimation automatique**: ${finalEstimate.estimate} pts (${finalEstimate.tshirtSize})\n\n`;
    comment += `📊 **Confiance**: ${finalEstimate.confidence}%\n\n`;
    
    if (finalEstimate.reasoning) {
      comment += `💡 **Raisonnement**: ${finalEstimate.reasoning}\n\n`;
    }
    
    comment += `<details>\n<summary>📋 Détails du calcul</summary>\n\n`;
    comment += `| Élément | Valeur |\n|---------|--------|\n`;
    comment += `| Assigné | ${breakdown.assignee} (${breakdown.assigneeDomain}) |\n`;
    comment += `| Baseline | ${breakdown.baseline} pts |\n`;
    comment += `| Modif. labels | ${breakdown.labelModifiers.modifier > 0 ? '+' : ''}${breakdown.labelModifiers.modifier} |\n`;
    comment += `| Modif. mots-clés | ${breakdown.keywordModifiers.modifier > 0 ? '+' : ''}${breakdown.keywordModifiers.modifier} |\n`;
    comment += `| Estimation brute | ${breakdown.rawEstimate} |\n`;
    comment += `| Estimation finale | ${finalEstimate.estimate} pts |\n`;
    comment += `\n</details>\n\n`;
    comment += `_Cette estimation est générée automatiquement. Ajustez si nécessaire._`;
    
    return comment;
  }

  /**
   * Convertit les points en taille T-Shirt
   */
  getTshirtSize(estimate) {
    const mapping = { 1: 'XS', 2: 'S', 3: 'M', 5: 'L', 8: 'XL', 13: 'XXL' };
    return mapping[estimate] || 'M';
  }
}

module.exports = EstimationService;
