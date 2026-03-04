const fs = require("fs");

// Environment configurations
const GITHUB_USER = process.env.GITHUB_REPOSITORY_OWNER;
const GITHUB_TOKEN = process.env.GH_TOKEN;
const HF_TOKEN = process.env.HF_TOKEN; 
const README_PATH = "README.md";
const TEMPLATE_PATH = "README_TEMPLATE.md";
const CACHE_PATH = "icon_cache.json";

const fetchOptions = GITHUB_TOKEN ? { headers: { Authorization: `token ${GITHUB_TOKEN}` } } : {};

// Load icon cache for persistence
let iconCache = fs.existsSync(CACHE_PATH) ? JSON.parse(fs.readFileSync(CACHE_PATH, "utf8")) : {};

/**
 * TOOL: Verifies if the Devicon URL actually exists on the CDN.
 */
async function verifyIconUrl(slug) {
  const url = `https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/${slug}/${slug}-original.svg`;
  try {
    const response = await fetch(url, { method: 'HEAD' });
    return response.ok; 
  } catch (err) {
    return false;
  }
}

/**
 * Normalizes technology names via Hugging Face.
 * It now returns a LIST of potential candidates.
 */
async function fetchSuggestionsFromAI(name) {
  if (!HF_TOKEN) return [name.toLowerCase().trim().replace(/\s+/g, '')];

  try {
    const response = await fetch("https://api-inference.huggingface.co/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${HF_TOKEN}` },
      body: JSON.stringify({
        model: "mistralai/Mistral-7B-Instruct-v0.2", 
        messages: [{
          role: "system",
          content: "You are a Devicon expert. Your task is to provide the 3 most likely folder names (slugs) for a technology, ordered by probability. Examples: 'CSS' -> 'css3, css, postcss'. Return ONLY the slugs separated by commas, no prose."
        }, { role: "user", content: name }],
        max_tokens: 20, temperature: 0
      })
    });
    const data = await response.json();
    if (!data.choices) return [name.toLowerCase().replace(/\s+/g, '')];
    
    // Split comma-separated string into an array of clean slugs
    return data.choices[0].message.content.split(',').map(s => s.trim().toLowerCase().replace(/[^a-z0-9]/g, ''));
  } catch (err) { 
    return [name.toLowerCase().replace(/\s+/g, '')]; 
  }
}

/**
 * Iterates through AI suggestions until a valid URL is found.
 */
async function getValidatedSlug(name) {
  const cleanName = name.trim();
  if (iconCache[cleanName] !== undefined) return iconCache[cleanName];

  console.log(`🔍 Finding best match for: ${cleanName}...`);
  const candidates = await fetchSuggestionsFromAI(cleanName);
  
  let finalSlug = null;

  // THE ITERATIVE LOOP: We try each candidate until one works
  for (const slug of candidates) {
    console.log(`   - Testing candidate: ${slug}`);
    const isValid = await verifyIconUrl(slug);
    if (isValid) {
      console.log(`   ✅ Match found: ${slug}`);
      finalSlug = slug;
      break; 
    }
  }

  if (!finalSlug) console.warn(`   ❌ No valid icon found for: ${cleanName}`);

  iconCache[cleanName] = finalSlug;
  fs.writeFileSync(CACHE_PATH, JSON.stringify(iconCache, null, 2));
  return finalSlug;
}

// Standard fetch and repo aggregation logic
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
    const slug = await getValidatedSlug(lang);
    const iconUrl = slug ? `https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/${slug}/${slug}-original.svg` : "";
    
    html += `<details>\n<summary style="cursor: pointer;">\n${slug ? `<img src="${iconUrl}" width="20" style="vertical-align: middle;"/>` : "📁"} &nbsp; <b>${repoList.length} Projects (${lang})</b>\n</summary>\n<blockquote>\n`;
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
    const slug = await getValidatedSlug(topic);
    const iconUrl = slug ? `https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/${slug}/${slug}-original.svg` : "";
    const label = topic.charAt(0).toUpperCase() + topic.slice(1);

    html += `<details>\n<summary style="cursor: pointer;">\n${slug ? `<img src="${iconUrl}" width="20" style="vertical-align: middle;"/>` : "🛠️"} &nbsp; <b>${repoList.length} Projects (${label})</b>\n</summary>\n<blockquote>\n`;
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
    console.log("README successfully generated in English with iterative validation.");
  } catch (err) { console.error(err); process.exit(1); }
}
generateReadme();
