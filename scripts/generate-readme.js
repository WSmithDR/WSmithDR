const fs = require("fs");

// Environment configurations
const GITHUB_USER = process.env.GITHUB_REPOSITORY_OWNER;
const GITHUB_TOKEN = process.env.GH_TOKEN;
const HF_TOKEN = process.env.HF_TOKEN; 
const README_PATH = "README.md";
const TEMPLATE_PATH = "README_TEMPLATE.md";
const CACHE_PATH = "icon_cache.json";

const fetchOptions = GITHUB_TOKEN ? { headers: { Authorization: `token ${GITHUB_TOKEN}` } } : {};

// Load icon cache (now stores full URLs instead of just slugs)
let iconCache = fs.existsSync(CACHE_PATH) ? JSON.parse(fs.readFileSync(CACHE_PATH, "utf8")) : {};

/**
 * DOUBLE VALIDATION TOOL: Checks both -original and -plain variants on Devicon.
 * Returns the full working URL, or null if it 404s.
 */
async function getValidIconUrl(slug) {
  const baseUrl = `https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/${slug}/${slug}`;
  try {
    // Check -original first
    let response = await fetch(`${baseUrl}-original.svg`, { method: 'HEAD' });
    if (response.ok) return `${baseUrl}-original.svg`;
    
    // Fallback to -plain if original doesn't exist
    response = await fetch(`${baseUrl}-plain.svg`, { method: 'HEAD' });
    if (response.ok) return `${baseUrl}-plain.svg`;

    return null;
  } catch (err) {
    return null;
  }
}

/**
 * JSON FORCED AI PROMPT: Uses Few-Shot prompting to guide gpt-oss-20b.
 * Forces the output to be a parsable JSON array to avoid conversational text errors.
 */
async function fetchSuggestionsFromGPTOSS(name) {
  if (!HF_TOKEN) return [];

  try {
    const response = await fetch("https://api-inference.huggingface.co/v1/chat/completions", {
      method: "POST",
      headers: { 
        "Content-Type": "application/json", 
        "Authorization": `Bearer ${HF_TOKEN}` 
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-20b", 
        messages: [
          {
            role: "system",
            content: "You are a Devicon routing API. Map the given technology to 5 possible Devicon folder names (slugs). RULES: 1. HTML -> html5. 2. CSS -> css3. 3. Jupyter Notebook -> jupyter. 4. Shell -> bash. 5. C# -> csharp. Output ONLY a valid JSON array of 5 strings ordered by probability. Example format: [\"html5\", \"html\", \"markup\", \"web\", \"xml\"]"
          }, 
          { role: "user", content: name }
        ],
        max_tokens: 50, 
        temperature: 0.1
      })
    });
    
    const data = await response.json();
    const content = data.choices[0].message.content;
    
    // Extract JSON array using regex in case the AI wraps it in markdown blocks
    const match = content.match(/\[.*\]/s);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return parsed.map(s => s.trim().toLowerCase().replace(/[^a-z0-9]/g, ''));
    }
    return [];
  } catch (err) { 
    return []; 
  }
}

/**
 * THE SMART ITERATOR: Combines exact matching with AI fallback.
 */
async function getValidatedIcon(name) {
  const cleanName = name.trim();
  if (iconCache[cleanName] !== undefined) return iconCache[cleanName]; // Returns cached URL or null

  console.log(`🔍 Resolving icon for: ${cleanName}...`);
  
  // Create an array of candidates: First we try the exact literal name, THEN the AI's suggestions
  const rawSlug = cleanName.toLowerCase().replace(/\s+/g, '');
  const aiSuggestions = await fetchSuggestionsFromGPTOSS(cleanName);
  
  // Remove duplicates to avoid wasting fetch requests
  const candidates = [...new Set([rawSlug, ...aiSuggestions])];
  
  let finalUrl = null;
  for (const slug of candidates) {
    console.log(`   - Testing Devicon slug: ${slug}`);
    finalUrl = await getValidIconUrl(slug);
    if (finalUrl) {
      console.log(`   ✅ Success! Found at: ${finalUrl}`);
      break; 
    }
  }

  if (!finalUrl) console.warn(`   ❌ Exhausted all candidates. No icon found for: ${cleanName}`);

  // Cache the final working URL directly
  iconCache[cleanName] = finalUrl;
  fs.writeFileSync(CACHE_PATH, JSON.stringify(iconCache, null, 2));
  return finalUrl;
}

// Data fetching logic
async function fetchAllPages(url) {
  let results = [];
  let page = 1;
  while (true) {
    const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}per_page=100&page=${page}`, fetchOptions);
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    const data = await res.json();
    if (data.length === 0) break;
    results = results.concat(data);
    page++;
  }
  return results;
}

async function getAllRepos() {
  const repos = await fetchAllPages(`https://api.github.com/user/repos?type=all&sort=updated`);
  const orgs = await fetchAllPages(`https://api.github.com/user/orgs`);
  let allRepos = [...repos];
  for (const org of orgs) {
    const orgRepos = await fetchAllPages(`https://api.github.com/orgs/${org.login}/repos?type=all&sort=updated`);
    allRepos = allRepos.concat(orgRepos);
  }
  const seen = new Set();
  return allRepos.filter(repo => {
    if (seen.has(repo.full_name)) return false;
    seen.add(repo.full_name);
    return true;
  });
}

// Content Rendering
async function getTopLanguages(repos) {
  const langMap = {};
  repos.forEach(repo => {
    if (repo.language && !repo.fork && repo.owner.login.toLowerCase() === GITHUB_USER.toLowerCase()) {
      if (!langMap[repo.language]) langMap[repo.language] = [];
      langMap[repo.language].push(repo);
    }
  });

  const sorted = Object.entries(langMap).sort((a, b) => b[1].length - a[1].length);
  let html = "";
  for (const [lang, repoList] of sorted) {
    const iconUrl = await getValidatedIcon(lang);
    html += `<details>\n<summary style="cursor: pointer;">\n${iconUrl ? `<img src="${iconUrl}" width="20" style="vertical-align: middle;"/>` : "📁"} &nbsp; <b>${repoList.length} Projects (${lang})</b>\n</summary>\n<blockquote>\n`;
    repoList.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at)).forEach(repo => {
      html += `<details>\n<summary style="cursor: pointer;"><a href="${repo.html_url}">${repo.name}</a></summary>\n<blockquote><i>${repo.description || "No description"}</i></blockquote>\n</details>\n`;
    });
    html += `</blockquote>\n</details>\n`;
  }
  return { count: sorted.length, html };
}

async function getTopFrameworks(repos) {
  const topicMap = {};
  const ignored = ['javascript', 'typescript', 'python', 'java', 'html', 'css', 'jupyter-notebook'];
  repos.forEach(repo => {
    if (!repo.fork && repo.owner.login.toLowerCase() === GITHUB_USER.toLowerCase() && repo.topics) {
      repo.topics.forEach(topic => {
        if (!ignored.includes(topic.toLowerCase())) {
          if (!topicMap[topic]) topicMap[topic] = [];
          topicMap[topic].push(repo);
        }
      });
    }
  });

  const sorted = Object.entries(topicMap).sort((a, b) => b[1].length - a[1].length);
  let html = "";
  for (const [topic, repoList] of sorted) {
    const iconUrl = await getValidatedIcon(topic);
    const label = topic.charAt(0).toUpperCase() + topic.slice(1);
    html += `<details>\n<summary style="cursor: pointer;">\n${iconUrl ? `<img src="${iconUrl}" width="20" style="vertical-align: middle;"/>` : "🛠️"} &nbsp; <b>${repoList.length} Projects (${label})</b>\n</summary>\n<blockquote>\n`;
    repoList.forEach(repo => {
      html += `<details>\n<summary style="cursor: pointer;"><a href="${repo.html_url}">${repo.name}</a></summary>\n<blockquote><i>${repo.description || "No description"}</i></blockquote>\n</details>\n`;
    });
    html += `</blockquote>\n</details>\n`;
  }
  return { count: sorted.length, html };
}

function getStarData(repos) {
  const starred = repos.filter(r => !r.fork && r.owner.login.toLowerCase() === GITHUB_USER.toLowerCase() && r.stargazers_count > 0)
    .sort((a, b) => b.stargazers_count - a.stargazers_count);
  let total = starred.reduce((s, r) => s + r.stargazers_count, 0);
  let html = starred.map(r => `<details style="margin-bottom: 5px;">\n<summary style="cursor: pointer;">⭐ <a href="${r.html_url}">${r.name}</a> - ${r.stargazers_count} stars</summary>\n<blockquote><i>${r.description || "No description"}</i></blockquote>\n</details>`).join("\n");
  return { total, html };
}

async function getAllUserProjects(repos) {
  const sorted = repos.filter(r => !r.fork && !r.private && r.owner.login.toLowerCase() === GITHUB_USER.toLowerCase())
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  const html = sorted.map(repo => `<details style="margin-bottom: 5px;">\n<summary style="cursor: pointer;"><a href="${repo.html_url}">${repo.name}</a></summary>\n<blockquote><i>${repo.description || "No description"}</i></blockquote>\n</details>`).join("\n");
  return { count: sorted.length, html };
}

async function generateReadme() {
  try {
    const template = fs.readFileSync(TEMPLATE_PATH, "utf8");
    const repos = await getAllRepos();
    const langData = await getTopLanguages(repos);
    const frameworkData = await getTopFrameworks(repos);
    const starData = getStarData(repos);
    const projectsData = await getAllUserProjects(repos);

    const output = template
      .replace(/{{TOTAL_LANGUAGES}}/g, langData.count)
      .replace(/{{PROGRAMMING_LANGUAGES}}/g, langData.html)
      .replace(/{{TOTAL_FRAMEWORKS}}/g, frameworkData.count)
      .replace(/{{FRAMEWORKS_AND_TOOLS}}/g, frameworkData.html)
      .replace(/{{TOTAL_STARS}}/g, starData.total)
      .replace(/{{STARRED_REPOS}}/g, starData.html)
      .replace(/{{GITHUB_USER}}/g, GITHUB_USER)
      .replace(/{{TOTAL_PROJECTS}}/g, projectsData.count)
      .replace(/{{ALL_PROJECTS}}/g, projectsData.html);

    fs.writeFileSync(README_PATH, output);
    console.log("Success: README updated in English with smart validation.");
  } catch (err) { console.error(err); process.exit(1); }
}
generateReadme();
