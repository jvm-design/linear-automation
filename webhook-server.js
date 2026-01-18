const express = require('express');
const { LinearClient } = require('@linear/sdk');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Initialize Linear client
const linearClient = new LinearClient({
  apiKey: process.env.LINEAR_API_KEY
});

// Middleware
app.use(express.json());

// Store team IDs (you'll need to configure these)
const PRODUCT_DESIGN_TEAM_ID = process.env.PRODUCT_DESIGN_TEAM_ID;
const DEV_TEAM_ID = process.env.DEV_TEAM_ID;

// Webhook endpoint
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

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.listen(port, () => {
  console.log(`Linear webhook server running on port ${port}`);
  console.log(`Webhook URL: http://localhost:${port}/webhook/linear`);
});