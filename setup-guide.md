# Linear Automation Setup Guide

## Overview

Ce serveur webhook fournit deux automatisations pour Linear:

1. **Auto-Estimation** 🤖 - Estime automatiquement les nouvelles issues basé sur:
   - L'assigné (vélocité historique par personne)
   - Les labels (IA, BUG, Migration, etc.)
   - Les mots-clés du titre/description
   - Validation/ajustement optionnel via Claude

2. **Transfert Product Design → DEV** - Transfère les issues complétées vers le triage DEV

---

## Setup Steps

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables

1. Copy `.env.example` to `.env`
2. Fill in the required values:

#### Get Linear API Key:
1. Go to Linear Settings → API
2. Create a new Personal API key
3. Copy the key to `LINEAR_API_KEY`

#### Get Team IDs:
```bash
node get-team-ids.js
```

#### Get Anthropic API Key (optionnel mais recommandé):
1. Go to https://console.anthropic.com/
2. Create an API key
3. Copy to `ANTHROPIC_API_KEY`

### 3. Setup Linear Webhooks

Vous devez créer **2 webhooks** dans Linear:

#### Webhook 1: Auto-Estimation (nouvelles issues)
1. Linear Settings → API → Webhooks → New Webhook
2. **URL**: `http://your-server.com/webhook/estimate`
3. **Events**: ✅ Issues → **Create only**
4. **Team**: DEV (ou toutes les équipes à estimer)

#### Webhook 2: Transfert Product Design (optionnel)
1. Linear Settings → API → Webhooks → New Webhook
2. **URL**: `http://your-server.com/webhook/linear`
3. **Events**: ✅ Issues → **Update**
4. **Team**: Product Design

### 4. Run the Server
```bash
# Development (avec hot-reload)
npm run dev

# Production
npm start
```

---

## 🤖 Auto-Estimation: Comment ça marche

### Logique d'estimation

L'estimation est calculée ainsi:

```
Estimate = clamp(1, 13, Baseline_Assigné + Σ Modificateurs)
```

#### Baselines par assigné (vélocité historique):
| Assigné | Baseline | Domaine | Vélocité moyenne |
|---------|----------|---------|------------------|
| Seb     | 2 pts    | FRONT   | ~23 pts/cycle    |
| Kevin   | 3 pts    | BACK    | ~16 pts/cycle    |
| Lucien  | 5 pts    | IA      | ~10 pts/cycle    |
| Panegna | 3 pts    | MOBILE  | ~10 pts/cycle    |
| Default | 3 pts    | -       | ~15 pts/cycle    |

#### Modificateurs par label:
| Label | Modificateur |
|-------|--------------|
| BUG, FIX, HOTFIX | -1 pt |
| IA, ML | +2 pts |
| MIGRATION, REFACTOR | +2 pts |
| E2E, TESTS | +1 pt |
| TRADUCTION | → 1 pt (override) |

#### Échelle T-Shirt → Points:
| Taille | Points | Effort |
|--------|--------|--------|
| XS | 1 pt | < 2h |
| S | 2 pts | 2-4h |
| M | 3 pts | 0.5-1 jour |
| L | 5 pts | 1-2 jours |
| XL | 8 pts | 2-4 jours |
| XXL | 13 pts | ~1 semaine |

### Claude Refinement (optionnel)

Si `ANTHROPIC_API_KEY` est configuré et que la confiance est < 80%, Claude analyse l'issue et peut ajuster l'estimation.

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/webhook/estimate` | POST | Webhook Linear pour auto-estimation |
| `/webhook/linear` | POST | Webhook transfert Product Design |
| `/api/estimate/:issueId` | POST | Estimation manuelle d'une issue |
| `/api/estimate/preview` | POST | Preview estimation sans mise à jour |
| `/api/config` | GET | Configuration actuelle |
| `/health` | GET | Health check |

### Exemples d'utilisation API

#### Preview une estimation:
```bash
curl -X POST http://localhost:3000/api/estimate/preview \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Fix z-index user menu",
    "assigneeName": "Seb",
    "labels": ["BUG", "FRONT"]
  }'
```

#### Estimer manuellement une issue existante:
```bash
curl -X POST http://localhost:3000/api/estimate/DEV-123
```

---

## Testing

### Test unitaire de l'estimation:
```bash
npm run test:estimate
```

### Test webhook manuel:
```bash
curl -X POST http://localhost:3000/webhook/estimate \
  -H "Content-Type: application/json" \
  -d '{
    "action": "create",
    "type": "Issue",
    "data": {
      "id": "test-123",
      "identifier": "DEV-999",
      "title": "Test estimation",
      "teamId": "your-dev-team-id"
    }
  }'
```

---

## 📊 Baselines Dynamiques (Vélocité)

Les baselines peuvent être calculées automatiquement depuis les 3 derniers cycles Linear.

### Mettre à jour les baselines

```bash
# Via CLI
npm run baselines:update

# Ou avec un nombre de cycles spécifique
node velocity-tracker.js 5 --update

# Voir le rapport sans mise à jour
npm run velocity
```

### Via API

```bash
# Voir les baselines actuelles
curl http://localhost:3000/api/baselines

# Mettre à jour les baselines (3 derniers cycles)
curl -X POST http://localhost:3000/api/baselines/update

# Mettre à jour avec 5 cycles
curl -X POST "http://localhost:3000/api/baselines/update?cycles=5"

# Voir le rapport de vélocité
curl http://localhost:3000/api/velocity
```

### Fichier team-baselines.json

Les baselines calculées sont sauvegardées dans `team-baselines.json`:

```json
{
  "_meta": {
    "generatedAt": "2026-02-04T10:30:00.000Z",
    "cyclesAnalyzed": 3,
    "cycles": [...]
  },
  "members": {
    "seb": {
      "id": "...",
      "fullName": "Seb",
      "baseline": 2,
      "stats": {
        "avgPointsPerCycle": 23,
        "avgIssuesPerCycle": 12,
        "avgPointsPerIssue": 1.9
      }
    }
  }
}
```

### Automatiser la mise à jour

Vous pouvez créer un cron job ou GitHub Action pour mettre à jour les baselines chaque semaine:

```bash
# Crontab: tous les lundis à 8h
0 8 * * 1 cd /path/to/project && npm run baselines:update
```

---

## Personnalisation Manuelle

### Modifier les baselines par défaut

Si vous n'utilisez pas les baselines dynamiques, éditez `estimation-config.js`:

```javascript
const DEFAULT_ASSIGNEE_BASELINES = {
  'seb': { baseline: 2, domain: 'FRONT', avgVelocity: 23 },
  'kevin': { baseline: 3, domain: 'BACK', avgVelocity: 16 },
  // Ajouter/modifier selon votre équipe
};
```

### Ajouter des modificateurs

```javascript
const LABEL_MODIFIERS = {
  'nouveau-label': +1,  // Ajoute 1 point
  'quick-fix': -1,      // Réduit de 1 point
};
```

### Ajouter un nouveau membre

1. Ajoutez-le dans `MEMBER_DOMAINS` pour son domaine:
```javascript
const MEMBER_DOMAINS = {
  'nouveau': 'BACK',
};
```

2. Exécutez `npm run baselines:update` pour calculer sa baseline automatiquement

---

## Troubleshooting

- **Estimation trop haute/basse**: Ajustez les baselines dans `estimation-config.js`
- **Claude ne répond pas**: Vérifiez `ANTHROPIC_API_KEY` et les logs
- **Webhook non reçu**: Vérifiez l'URL et que le serveur est accessible depuis Internet
- **Issue non estimée**: Vérifiez que `AUTO_ESTIMATE_TEAM_IDS` contient le bon team ID

### Logs utiles:
```bash
# Voir les logs en temps réel
npm run dev

# Dans les logs, cherchez:
# [Webhook Estimate] pour les webhooks reçus
# [Estimation] pour le détail des calculs
```