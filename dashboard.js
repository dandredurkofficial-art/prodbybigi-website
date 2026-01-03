function show(id){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function logout(){
  localStorage.removeItem("loggedIn");
  location.href="login.html";
}

if(!localStorage.getItem("loggedIn")){
  location.href="login.html";
}
