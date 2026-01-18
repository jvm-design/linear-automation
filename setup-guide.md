# Linear Automation Setup Guide

## Overview
This automation transfers completed Product Design issues to the DEV team's triage section.

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
Run this helper script to find your team IDs:
```javascript
// Run in node or add to a temp file
const { LinearClient } = require('@linear/sdk');
const linear = new LinearClient({ apiKey: 'your_api_key' });

async function getTeams() {
  const teams = await linear.teams();
  teams.nodes.forEach(team => {
    console.log(`${team.name}: ${team.id}`);
  });
}

getTeams();
```

### 3. Setup Linear Webhook
1. In Linear, go to Settings → API
2. Click "New webhook"
3. Set URL to: `http://your-server.com/webhook/linear`
4. Select resource types: `Issue`
5. Set team to your Product Design team (or all teams)

### 4. Run the Server
```bash
# Development
npm run dev

# Production
npm start
```

## How It Works

1. **Webhook Trigger**: Linear sends a webhook when any issue is updated
2. **Filter**: Server checks if:
   - Update is from Product Design team
   - Issue status changed to "Done"
3. **Transfer**: Creates new issue in DEV team's triage with:
   - "[From Product Design]" prefix
   - Original title and description
   - Same priority and labels
4. **Notification**: Adds comment to original issue with link to new DEV issue

## Testing

1. Create a test issue in Product Design team
2. Move it to "Done" status
3. Check DEV team triage for the transferred issue

## Troubleshooting

- Check server logs for errors
- Verify environment variables are correct
- Ensure webhook URL is accessible from Linear
- Test webhook with curl:
```bash
curl -X POST http://localhost:3000/webhook/linear \
  -H "Content-Type: application/json" \
  -d '{"action":"update","type":"Issue","data":{"teamId":"test"}}'
```