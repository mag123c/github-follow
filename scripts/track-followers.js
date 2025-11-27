const fs = require('fs');
const path = require('path');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_USERNAME = process.env.GITHUB_USERNAME;
const DATA_FILE = path.join(__dirname, '..', 'data', 'followers.json');

async function getFollowers(username) {
  const followers = [];
  let page = 1;

  while (true) {
    const response = await fetch(
      `https://api.github.com/users/${username}/followers?per_page=100&page=${page}`,
      {
        headers: {
          'Authorization': `Bearer ${GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'github-follow-tracker'
        }
      }
    );

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    if (data.length === 0) break;

    followers.push(...data.map(f => ({
      id: f.id,
      login: f.login,
      avatar_url: f.avatar_url,
      html_url: f.html_url
    })));

    page++;
  }

  return followers;
}

function loadPreviousFollowers() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (e) {
    console.log('No previous data found, starting fresh');
  }
  return [];
}

function saveFollowers(followers) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(followers, null, 2));
}

function compareFollowers(previous, current) {
  const prevLogins = new Set(previous.map(f => f.login));
  const currLogins = new Set(current.map(f => f.login));

  const added = current.filter(f => !prevLogins.has(f.login));
  const removed = previous.filter(f => !currLogins.has(f.login));

  return { added, removed };
}

async function createGitHubIssue(title, body) {
  const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'github-follow-tracker'
      },
      body: JSON.stringify({ title, body })
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to create issue: ${response.status}`);
  }

  return response.json();
}

async function main() {
  if (!GITHUB_TOKEN || !GITHUB_USERNAME) {
    console.error('GITHUB_TOKEN and GITHUB_USERNAME are required');
    process.exit(1);
  }

  console.log(`Fetching followers for ${GITHUB_USERNAME}...`);

  const currentFollowers = await getFollowers(GITHUB_USERNAME);
  const previousFollowers = loadPreviousFollowers();

  console.log(`Current followers: ${currentFollowers.length}`);
  console.log(`Previous followers: ${previousFollowers.length}`);

  const { added, removed } = compareFollowers(previousFollowers, currentFollowers);

  // Output for GitHub Actions
  const hasChanges = added.length > 0 || removed.length > 0;

  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `has_changes=${hasChanges}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `added_count=${added.length}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `removed_count=${removed.length}\n`);
  }

  if (hasChanges) {
    console.log('\n=== Changes Detected ===');

    if (added.length > 0) {
      console.log(`\n New followers (+${added.length}):`);
      added.forEach(f => console.log(`  - @${f.login}`));
    }

    if (removed.length > 0) {
      console.log(`\n Unfollowed (-${removed.length}):`);
      removed.forEach(f => console.log(`  - @${f.login}`));
    }

    // Create GitHub Issue if running in Actions
    if (process.env.GITHUB_ACTIONS === 'true' && process.env.CREATE_ISSUE === 'true') {
      const date = new Date().toISOString().split('T')[0];
      let body = `## Follower Changes - ${date}\n\n`;

      if (added.length > 0) {
        body += `### New Followers (+${added.length})\n`;
        added.forEach(f => {
          body += `- [@${f.login}](${f.html_url})\n`;
        });
        body += '\n';
      }

      if (removed.length > 0) {
        body += `### Unfollowed (-${removed.length})\n`;
        removed.forEach(f => {
          body += `- [@${f.login}](${f.html_url})\n`;
        });
      }

      body += `\n---\n*Total followers: ${currentFollowers.length}*`;

      await createGitHubIssue(`Follower Update: +${added.length} / -${removed.length}`, body);
      console.log('\nGitHub Issue created!');
    }
  } else {
    console.log('\nNo changes detected.');
  }

  // Save current state
  saveFollowers(currentFollowers);
  console.log('\nFollowers data saved.');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
