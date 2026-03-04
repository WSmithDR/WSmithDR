const fs = require("fs");

// Environment configurations
const GITHUB_USER = process.env.GITHUB_REPOSITORY_OWNER;
const GITHUB_TOKEN = process.env.GH_TOKEN;
const HF_TOKEN = process.env.HF_TOKEN; 
const README_PATH = "README.md";
const TEMPLATE_PATH = "README_TEMPLATE.md";
const CACHE_PATH = "icon_cache.json";

const fetchOptions = GITHUB_TOKEN ? { headers: { Authorization: `token ${GITHUB_TOKEN}` } } : {};

// Robust JSON loader to prevent SyntaxErrors from crashing the build
let iconCache = {};
if (fs.existsSync(CACHE_PATH)) {
  try {
    const data = fs.readFileSync(CACHE_PATH, "utf8");
    iconCache = data.trim() ? JSON.parse(data) : {};
  } catch (e) {
    console.error("⚠️ Cache file corrupted. Resetting to empty object.");
    iconCache = {};
  }
}

/**
 * TOOL: Verifies if the Devicon URL actually exists.
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
 * Fetches potential slugs from GPT-OSS-20B via Hugging Face.
 */
async function fetchSuggestionsFromGPTOSS(name) {
  if (!HF_TOKEN) return [name.toLowerCase().trim().replace(/\s+/g, '')];

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
            content: "Reasoning: low. You are a Devicon expert. Provide the 3 most likely slugs for a technology. Order by probability. Use versioning (e.g., 'CSS' -> 'css3, css, postcss'). Return ONLY the slugs separated by commas."
          }, 
          { role: "user", content: name }
        ],
        max_tokens: 30, 
        temperature: 0
      })
    });
    const data = await response.json();
    if (!data.choices) return [name.toLowerCase().replace(/\s+/g, '')];
    
    return data.choices[0].message.content.split(',').map(s => s.trim().toLowerCase().replace(/[^a-z0-9]/g, ''));
  } catch (err) { 
    return [name.toLowerCase().replace(/\s+/g, '')]; 
  }
}

async function getValidatedSlug(name) {
  const cleanName = name.trim();
  if (iconCache[cleanName] !== undefined) return iconCache[cleanName];

  console.log(`🔍 GPT-OSS match for: ${cleanName}...`);
  const candidates = await fetchSuggestionsFromGPTOSS(cleanName);
  
  let finalSlug = null;
  for (const slug of candidates) {
    const isValid = await verifyIconUrl(slug);
    if (isValid) {
      finalSlug = slug;
      break; 
    }
  }

  iconCache[cleanName] = finalSlug;
  fs.writeFileSync(CACHE_PATH, JSON.stringify(iconCache, null, 2));
  return finalSlug;
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

// CONTENT GENERATION - STRICT ENGLISH
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
    console.log("Success: README updated in English.");
  } catch (err) { console.error(err); process.exit(1); }
}
generateReadme();
