const fs = require("fs");
const fetch = require("node-fetch");

const GITHUB_USER = process.env.GITHUB_USER || "WSmithDR";
const README_PATH = "README.md";
const TEMPLATE_PATH = "README_TEMPLATE.md";
const GITHUB_TOKEN = process.env.GH_TOKEN;

const fetchOptions = GITHUB_TOKEN
  ? { headers: { Authorization: `token ${GITHUB_TOKEN}` } }
  : {};

async function fetchAllPages(url) {
  let results = [];
  let page = 1;
  while (true) {
    const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}per_page=100&page=${page}` , fetchOptions);
    if (!res.ok) throw new Error(`GitHub API error: ${res.status} (${url})`);
    const data = await res.json();
    if (data.length === 0) break;
    results = results.concat(data);
    page++;
  }
  return results;
}

async function getUserRepos() {
  return await fetchAllPages(`https://api.github.com/user/repos?type=all&sort=updated`);
}

async function getOrgs() {
  const orgs = await fetchAllPages(`https://api.github.com/user/orgs`);
  return orgs.map(org => org.login);
}

async function getOrgRepos(org) {
  return await fetchAllPages(`https://api.github.com/orgs/${org}/repos?type=all&sort=updated`);
}

async function getAllRepos() {
  let repos = await getUserRepos();
  const orgs = await getOrgs();
  for (const org of orgs) {
    const orgRepos = await getOrgRepos(org);
    repos = repos.concat(orgRepos);
  }
  const seen = new Set();
  const uniqueRepos = repos.filter(repo => {
    if (seen.has(repo.full_name)) return false;
    seen.add(repo.full_name);
    return true;
  });
  return uniqueRepos;
}

async function getTopLanguages(repos) {
  const langMap = {};
  
  repos.forEach(repo => {
    if (repo.language && !repo.fork && repo.owner.login.toLowerCase() === GITHUB_USER.toLowerCase()) {
      const lang = repo.language;
      if (!langMap[lang]) langMap[lang] = [];
      langMap[lang].push(repo);
    }
  });

  const sorted = Object.entries(langMap).sort((a, b) => b[1].length - a[1].length);
  
  let html = "";
  sorted.forEach(([lang, repoList]) => {
    const encodedLang = encodeURIComponent(lang);
    const logoName = lang.toLowerCase().replace(/\+/g, "plus").replace(/#/g, "sharp").replace(/\s+/g, "");
    const label = repoList.length === 1 ? 'Project' : 'Projects';
    
    html += `<details>\n`;
    html += `  <summary>\n`;
    html += `    <img src="https://img.shields.io/badge/${encodedLang}-${repoList.length}_${label}-00bfa5?style=flat-square&logo=${logoName}&logoColor=white" style="cursor: pointer; margin-bottom: 5px;" />\n`;
    html += `  </summary>\n`;
    html += `  <ul>\n`;
    
    repoList.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
    
    repoList.forEach(repo => {
      const desc = repo.description ? ` - ${repo.description}` : "";
      html += `    <li><a href="https://github.com/${repo.full_name}">${repo.name}</a>${desc}</li>\n`;
    });
    
    html += `  </ul>\n`;
    html += `</details>\n<br>\n`;
  });
  
  return html || "No languages detected yet";
}

// LÓGICA NUEVA: Extrae el total y genera la lista HTML de repositorios con estrellas
function getStarData(repos) {
  let total = 0;
  const starredRepos = [];

  repos.forEach(repo => {
    if (!repo.fork && repo.owner.login.toLowerCase() === GITHUB_USER.toLowerCase() && repo.stargazers_count > 0) {
      total += repo.stargazers_count;
      starredRepos.push(repo);
    }
  });

  starredRepos.sort((a, b) => b.stargazers_count - a.stargazers_count);

  let listHTML = "";
  if (starredRepos.length > 0) {
    listHTML += `<ul>\n`;
    starredRepos.forEach(repo => {
      listHTML += `  <li><a href="https://github.com/${repo.full_name}">${repo.name}</a> - ${repo.stargazers_count} ⭐</li>\n`;
    });
    listHTML += `</ul>`;
  } else {
    listHTML = "<p align=\"center\">No starred repositories yet.</p>";
  }

  return { total, listHTML };
}

// LÓGICA NUEVA: Devuelve todos los proyectos del usuario en formato de lista para el menú desplegable
async function getAllUserProjects(repos) {
  const sorted = repos.filter(r => !r.fork && !r.private && r.owner.login.toLowerCase() === GITHUB_USER.toLowerCase())
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
    
  return sorted.map(repo =>
    `    <li><a href="https://github.com/${repo.full_name}">${repo.name}</a> - ${repo.description || "No description"}</li>`
  ).join("\n");
}

function getSkillsProgress(repos) {
  const langCount = {};
  let total = 0;
  repos.forEach(repo => {
    if (repo.language && !repo.fork && !repo.private && repo.owner.login.toLowerCase() === GITHUB_USER.toLowerCase()) {
      const lang = repo.language;
      langCount[lang] = (langCount[lang] || 0) + 1;
      total++;
    }
  });
  const sorted = Object.entries(langCount).sort((a, b) => b[1] - a[1]);
  return sorted.slice(0, 8).map(([lang, count]) => {
    const percent = ((count / total) * 100).toFixed(1);
    return `<b>${lang}</b> <progress value="${percent}" max="100"></progress> ${percent}%`;
  }).join("<br>\n");
}

async function generateReadme() {
  try {
    const template = fs.readFileSync(TEMPLATE_PATH, "utf8");
    const repos = await getAllRepos();
    
    const techIcons = await getTopLanguages(repos);
    const starData = getStarData(repos);
    const allProjects = await getAllUserProjects(repos);
    const skillsProgress = getSkillsProgress(repos);

    const output = template
      .replace(/{{TECH_STACK_ICONS}}/g, techIcons)
      .replace(/{{TOTAL_STARS}}/g, starData.total)
      .replace(/{{STARRED_REPOS}}/g, starData.listHTML)
      .replace(/{{GITHUB_USER}}/g, GITHUB_USER)
      .replace(/{{ALL_PROJECTS}}/g, allProjects)
      .replace(/{{SKILLS_PROGRESS}}/g, skillsProgress);

    fs.writeFileSync(README_PATH, output);
    console.log("README.md updated successfully!");
  } catch (err) {
    console.error("Error generating README:", err);
    process.exit(1);
  }
}

generateReadme();
