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
  const totalLanguages = sorted.length;
  
  const getIconUrl = (lang) => {
    const map = {
      "javascript": "javascript/javascript-original.svg",
      "typescript": "typescript/typescript-original.svg",
      "python": "python/python-original.svg",
      "java": "java/java-original.svg",
      "jupyter notebook": "jupyter/jupyter-original.svg",
      "css": "css3/css3-original.svg",
      "html": "html5/html5-original.svg",
      "shell": "bash/bash-original.svg",
      "c++": "cplusplus/cplusplus-original.svg",
      "c#": "csharp/csharp-original.svg",
      "php": "php/php-original.svg",
      "go": "go/go-original.svg",
      "ruby": "ruby/ruby-original.svg",
      "r": "r/r-original.svg"
    };
    const path = map[lang.toLowerCase()];
    return path ? `https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/${path}` : null;
  };

  let html = "";
  sorted.forEach(([lang, repoList]) => {
    const label = repoList.length === 1 ? 'Project' : 'Projects';
    const iconUrl = getIconUrl(lang);
    
    html += `<details>\n`;
    html += `  <summary style="cursor: pointer;">\n`;
    
    if (iconUrl) {
      html += `    <img src="${iconUrl}" width="24" title="${lang}" alt="${lang}" /> &nbsp; <b>${repoList.length} ${label}</b>\n`;
    } else {
      html += `    <b>${lang}</b> &nbsp; ${repoList.length} ${label}\n`;
    }
    
    html += `  </summary>\n`;
    html += `  <div style="margin-left: 15px;">\n`;
    
    repoList.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
    
    repoList.forEach(repo => {
      const desc = repo.description ? repo.description : "No description";
      html += `    <details>\n`;
      html += `      <summary><a href="https://github.com/${repo.full_name}">${repo.name}</a></summary>\n`;
      html += `      <p><i>${desc}</i></p>\n`;
      html += `    </details>\n`;
    });
    
    html += `  </div>\n`;
    html += `</details>\n<br>\n`;
  });
  
  return { count: totalLanguages, html: html || "No languages detected yet" };
}

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

async function getAllUserProjects(repos) {
  const sorted = repos.filter(r => !r.fork && !r.private && r.owner.login.toLowerCase() === GITHUB_USER.toLowerCase())
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
    
  const listHTML = sorted.map(repo => {
    const desc = repo.description ? repo.description : "No description";
    return `    <details>\n      <summary><a href="https://github.com/${repo.full_name}">${repo.name}</a></summary>\n      <p><i>${desc}</i></p>\n    </details>`;
  }).join("\n");

  return { count: sorted.length, listHTML };
}

async function generateReadme() {
  try {
    const template = fs.readFileSync(TEMPLATE_PATH, "utf8");
    const repos = await getAllRepos();
    
    const langData = await getTopLanguages(repos);
    const starData = getStarData(repos);
    const projectsData = await getAllUserProjects(repos);

    const output = template
      .replace(/{{TOTAL_LANGUAGES}}/g, langData.count)
      .replace(/{{PROGRAMMING_LANGUAGES}}/g, langData.html)
      .replace(/{{TOTAL_STARS}}/g, starData.total)
      .replace(/{{STARRED_REPOS}}/g, starData.listHTML)
      .replace(/{{GITHUB_USER}}/g, GITHUB_USER)
      .replace(/{{TOTAL_PROJECTS}}/g, projectsData.count)
      .replace(/{{ALL_PROJECTS}}/g, projectsData.listHTML);

    fs.writeFileSync(README_PATH, output);
    console.log("README.md updated successfully!");
  } catch (err) {
    console.error("Error generating README:", err);
    process.exit(1);
  }
}

generateReadme();
