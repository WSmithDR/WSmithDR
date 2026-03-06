const fs = require("fs");

// Environment configurations
const GITHUB_USER = process.env.GITHUB_REPOSITORY_OWNER;
const GITHUB_TOKEN = process.env.GH_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 
const README_PATH = "README.md";
const TEMPLATE_PATH = "README_TEMPLATE.md";
const CACHE_PATH = "icon_cache.json";

const fetchOptions = GITHUB_TOKEN ? { headers: { Authorization: `token ${GITHUB_TOKEN}` } } : {};

// Load icon cache
let iconCache = fs.existsSync(CACHE_PATH) ? JSON.parse(fs.readFileSync(CACHE_PATH, "utf8")) : {};

/**
 * DOUBLE VALIDATION TOOL: Checks both -original and -plain variants.
 */
async function getValidIconUrl(slug) {
  const baseUrl = `https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/${slug}/${slug}`;
  try {
    let response = await fetch(`${baseUrl}-original.svg`, { method: 'HEAD' });
    if (response.ok) return `${baseUrl}-original.svg`;
    
    response = await fetch(`${baseUrl}-plain.svg`, { method: 'HEAD' });
    if (response.ok) return `${baseUrl}-plain.svg`;

    return null;
  } catch (err) {
    return null;
  }
}

/**
 * AI PROMPT WITH NEGATIVE FEEDBACK (Powered by Gemini)
 * Uses strict XML delimiters to force a pure JSON array output.
 */
async function fetchSuggestionsFromGemini(name, failedSlugs = []) {
  if (!GEMINI_API_KEY) {
    console.log("   ⚠️ ERROR: No GEMINI_API_KEY detected in the environment.");
    return [];
  }

  const avoidText = failedSlugs.length > 0 
    ? ` DO NOT suggest these exactly: [${failedSlugs.join(", ")}]` 
    : "";

  const promptText = `Map the technology to 5 Devicon folder names (slugs). RULES: 1. HTML -> html5 2. CSS -> css3 3. Jupyter -> jupyter 4. Shell -> bash.${avoidText} Technology: ${name}`;

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: "You are a strict data-routing API. You only output valid JSON. No conversational text." }]
        },
        contents: [{ parts: [{ text: promptText }] }],
        generationConfig: {
          temperature: 0.1,
          // Eliminamos el maxOutputTokens para no cortarle la frase
          responseMimeType: "application/json",
          // LA MAGIA: Forzamos la estructura exacta que queremos recibir
          responseSchema: {
            type: "OBJECT",
            properties: {
              slugs: {
                type: "ARRAY",
                items: { type: "STRING" }
              }
            },
            required: ["slugs"]
          }
        }
      })
    });
    
    if (!response.ok) {
      console.log(`   🚨 API Error (${response.status}): Request rejected by Gemini.`);
      return [];
    }

    const data = await response.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!content) {
      console.log(`   🚨 API Error: Respuesta vacía.`);
      return [];
    }

    // Como forzamos el esquema, el parseo es directo y seguro
    try {
      const parsed = JSON.parse(content);
      if (parsed.slugs && Array.isArray(parsed.slugs)) {
        const finalSlugs = parsed.slugs.map(s => s.trim().toLowerCase().replace(/[^a-z0-9]/g, ''));
        console.log(`   🤖 Gemini sugirió: [${finalSlugs.join(', ')}]`);
        return finalSlugs;
      }
    } catch (parseError) {
      console.log(`   🚨 Error parseando JSON: ${parseError.message}. Recibido crudo: ${content}`);
    }
    
    return [];
    
  } catch (err) { 
    console.log(`   🚨 Exception with Gemini: ${err.message}`);
    return []; 
  }
}

/**
 * THE SMART ITERATOR WITH MEMORY
 */
async function getValidatedIcon(name) {
  const cleanName = name.trim();
  
  // 1. Auto-migrate old string-based cache to the new object-based structure
  if (typeof iconCache[cleanName] === 'string' || !iconCache[cleanName]) {
    iconCache[cleanName] = { 
      valid: typeof iconCache[cleanName] === 'string' ? iconCache[cleanName] : null, 
      failed: [] 
    };
  }

  // 2. Return immediately if we already found a valid URL in a previous run
  if (iconCache[cleanName].valid) {
    return iconCache[cleanName].valid;
  }

  console.log(`\n🔍 Resolving icon for: ${cleanName}...`);
  
  const rawSlug = cleanName.toLowerCase().replace(/\s+/g, '');
  
  // Pass the failed list to the AI so it knows what to avoid
  const aiSuggestions = await fetchSuggestionsFromGemini(cleanName, iconCache[cleanName].failed);
  
  const candidates = [...new Set([rawSlug, ...aiSuggestions])];
  
  let finalUrl = null;
  for (const slug of candidates) {
    // Skip if we already know this slug fails
    if (iconCache[cleanName].failed.includes(slug)) {
      console.log(`   ⏭️ Skipping known failure: ${slug}`);
      continue; 
    }

    console.log(`   - Testing Devicon slug: ${slug}`);
    finalUrl = await getValidIconUrl(slug);
    
    if (finalUrl) {
      console.log(`   ✅ Success! Found at: ${finalUrl}`);
      iconCache[cleanName].valid = finalUrl; // Save the win
      break; 
    } else {
      console.log(`   ❌ Failed (404): ${slug}`);
      iconCache[cleanName].failed.push(slug); // Save the failure to the blacklist
    }
  }

  if (!finalUrl) console.warn(`   ⚠️ Exhausted candidates. Will try new ones next time for: ${cleanName}`);

  // Save progress to the file (both successes and new failures)
  fs.writeFileSync(CACHE_PATH, JSON.stringify(iconCache, null, 2));
  return iconCache[cleanName].valid;
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
    if(repo.private) return false;
    if (seen.has(repo.full_name)) return false;
    seen.add(repo.full_name);
    return true;
  });
}

// Content Rendering (English)
async function getTopLanguages(repos) {
  const langMap = {};
  const ignoredLanguages = ['html', 'css', 'jupyter notebook'];
  repos.forEach(repo => {
    if (repo.language 
        && !repo.fork 
        && repo.owner.login.toLowerCase() === GITHUB_USER.toLowerCase()
        && !ignoredLanguages.includes(repo.language.toLowerCase()
        ) ){
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
    console.log("Success: README updated with Stateful Cache and Gemini 3.1 AI.");
  } catch (err) { console.error(err); process.exit(1); }
}
generateReadme();
