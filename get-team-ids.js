const { LinearClient } = require('@linear/sdk');
require('dotenv').config();

async function getTeamIds() {
  if (!process.env.LINEAR_API_KEY || process.env.LINEAR_API_KEY === 'your_linear_api_key_here') {
    console.log('❌ Please set LINEAR_API_KEY in .env file first!');
    return;
  }

  try {
    const linear = new LinearClient({
      apiKey: process.env.LINEAR_API_KEY
    });

    console.log('🔍 Fetching your Linear teams...\n');
    
    const teams = await linear.teams();
    
    console.log('📋 Your teams:');
    teams.nodes.forEach(team => {
      console.log(`• ${team.name}: ${team.id}`);
    });
    
    console.log('\n📝 Copy the team IDs to your .env file:');
    console.log('PRODUCT_DESIGN_TEAM_ID=<your_product_design_team_id>');
    console.log('DEV_TEAM_ID=<your_dev_team_id>');
    
  } catch (error) {
    console.error('❌ Error fetching teams:', error.message);
    console.log('Make sure your API key is correct!');
  }
}

getTeamIds();