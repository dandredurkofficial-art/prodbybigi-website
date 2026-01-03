<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Producer Dashboard</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<script src="https://www.paypal.com/sdk/js?client-id=AdurYcARCdHIlIJL9uH2ui23x2VV4AUbuGdTeBGDJUMTdb99sc7ntdekg8jszs3v6r1UXeJrfJ9oXPvO"></script>
<style>
*{box-sizing:border-box;font-family:Inter}
body{margin:0;background:#0b0d12;color:#fff;display:flex;min-height:100vh}
.sidebar{width:260px;background:#0f1219;padding:22px;position:fixed;left:0;top:0;bottom:0;border-right:1px solid #1d2230;transition:.3s;z-index:1000}
.sidebar h1{font-size:20px;margin-bottom:24px;color:#6cf}
.sidebar a{display:block;padding:12px 14px;border-radius:12px;color:#b8c1d9;text-decoration:none;margin-bottom:6px;font-weight:500;cursor:pointer}
.sidebar a:hover{background:#1b2133;color:#fff}
.sidebar.show{left:0}
.main{flex:1;margin-left:260px;display:flex;flex-direction:column}
.topbar{height:72px;background:#0f1219;border-bottom:1px solid #1d2230;display:flex;align-items:center;justify-content:space-between;padding:0 22px}
.hamburger{font-size:22px;cursor:pointer;display:none}
.logout{background:#ef4444;border:none;padding:8px 14px;border-radius:10px;font-weight:600;color:#fff;cursor:pointer}
.content{padding:26px;overflow-y:auto}
.page{display:none}
.page.active{display:block}
.card{background:#121726;border:1px solid #1d2230;border-radius:18px;padding:22px;margin-bottom:22px}
.beat{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
button{background:#6cf;border:none;padding:8px 14px;border-radius:10px;font-weight:700;cursor:pointer;color:#000}
button.small{font-size:12px}
@media(max-width:900px){.sidebar{left:-260px}.main{margin-left:0}.hamburger{display:block}}
</style>
</head>
<body>
<div class="sidebar" id="sidebar">
<h1>ProdByBigi</h1>
<a onclick="loadPage('dashboard')">Dashboard</a>
<a onclick="loadPage('tracks')">Tracks</a>
<a onclick="loadPage('finance')">Finance</a>
</div>
<div class="main">
<div class="topbar">
<div class="hamburger" id="hamburger" onclick="toggleMenu()">☰</div>
<strong id="pageTitle">Dashboard</strong>
<button class="logout" onclick="logout()">Logout</button>
</div>
<div class="content">
<div id="dashboard" class="page active"><div class="card"><h3>Welcome</h3></div></div>
<div id="tracks" class="page"><div class="card"><h3>Your Beats</h3><div id="beatList"></div></div></div>
<div id="finance" class="page"><div class="card"><h3>Sales</h3><div id="sales"></div></div></div>
</div></div>
<script type="module">
import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js';
import { getFirestore, collection, getDocs } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js';
const firebaseConfig={apiKey:'AIzaSyAlh6_jXAJ2Wdyfw04Ieb9NqIoa8ZziuxE',authDomain:'prodbybigi.firebaseapp.com',projectId:'prodbybigi',storageBucket:'prodbybigi.firebasestorage.app',appId:'1:1040553526206:web:38216a9f75eabfe556efef'};
const app=initializeApp(firebaseConfig);
const auth=getAuth(app);
const db=getFirestore(app);
window.logout=()=>signOut(auth).then(()=>location.href='login.html');
window.toggleMenu=()=>{const s=sidebar.classList.toggle('show');hamburger.textContent=s?'✕':'☰'};
window.loadPage=p=>{document.querySelectorAll('.page').forEach(x=>x.classList.remove('active'));document.getElementById(p).classList.add('active');pageTitle.textContent=p.charAt(0).toUpperCase()+p.slice(1);if(innerWidth<900){sidebar.classList.remove('show');hamburger.textContent='☰'}};
async function loadBeats(){beatList.innerHTML='';const q=await getDocs(collection(db,'beats'));q.forEach(d=>{const b=d.data();beatList.innerHTML+=`<div class='beat'><span>${b.title} - $${b.price}</span><button class='small' onclick="window.open('beat.html?beat=${d.id}','_blank')">Buy</button></div>`})}
onAuthStateChanged(auth,u=>{if(!u)location.href='login.html';loadBeats()});
</script>
</body>
</html>
