// Test script to simulate Linear webhook payloads
const axios = require('axios');

const WEBHOOK_URL = 'http://localhost:3000/webhook/linear';

// Sample webhook payload for issue status change to "Done"
const testPayload = {
  "action": "update",
  "type": "Issue", 
  "data": {
    "id": "test-issue-123",
    "identifier": "PD-123",
    "title": "Design new user onboarding flow",
    "description": "Create wireframes and mockups for the user onboarding experience",
    "teamId": "product-design-team-id", // Replace with actual Product Design team ID
    "stateId": "done-state-id", // Replace with actual "Done" state ID
    "priority": 2,
    "labelIds": ["design-label-id"]
  },
  "updatedFrom": {
    "stateId": "in-progress-state-id" // Previous state before "Done"
  }
};

async function testWebhook() {
  try {
    console.log('Sending test webhook payload...');
    
    const response = await axios.post(WEBHOOK_URL, testPayload, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    console.log('✅ Webhook test successful!');
    console.log('Status:', response.status);
    console.log('Response:', response.data);
    
  } catch (error) {
    console.error('❌ Webhook test failed:');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
    } else {
      console.error('Error:', error.message);
    }
  }
}

// Test different scenarios
async function runAllTests() {
  console.log('=== Linear Webhook Automation Tests ===\n');
  
  // Test 1: Valid Product Design issue marked as Done
  console.log('Test 1: Product Design issue completed');
  await testWebhook();
  
  // Test 2: Issue from different team (should be ignored)
  console.log('\nTest 2: Issue from different team (should be ignored)');
  const differentTeamPayload = { ...testPayload };
  differentTeamPayload.data.teamId = 'different-team-id';
  
  try {
    await axios.post(WEBHOOK_URL, differentTeamPayload, {
      headers: { 'Content-Type': 'application/json' }
    });
    console.log('✅ Different team test passed (ignored as expected)');
  } catch (error) {
    console.error('❌ Different team test failed:', error.message);
  }
  
  // Test 3: Non-issue webhook (should be ignored)
  console.log('\nTest 3: Non-issue webhook (should be ignored)');
  const commentPayload = {
    action: 'create',
    type: 'Comment',
    data: { id: 'comment-123' }
  };
  
  try {
    await axios.post(WEBHOOK_URL, commentPayload, {
      headers: { 'Content-Type': 'application/json' }
    });
    console.log('✅ Non-issue test passed (ignored as expected)');
  } catch (error) {
    console.error('❌ Non-issue test failed:', error.message);
  }
  
  console.log('\n=== Tests completed ===');
}

if (require.main === module) {
  runAllTests();
}

module.exports = { testWebhook, runAllTests };