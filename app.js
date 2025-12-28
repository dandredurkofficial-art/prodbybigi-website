const beats=[
 {title:"Drill Night", producer:"Bigi Beats", price:2500},
 {title:"Afro Wave", producer:"Jay Producer", price:1800}
];
const grid=document.getElementById('beats');
if(grid){
 beats.forEach(b=>{
  const d=document.createElement('div');
  d.className='beat';
  d.innerHTML=`<h4>${b.title}</h4><p>by ${b.producer}</p><p>KES ${b.price}</p>
  <button class="btn">Buy (Demo)</button>`;
  grid.appendChild(d);
 });
}
