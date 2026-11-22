/* Beemo Air · Portal de agencias */
(function(){
'use strict';
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>'US$'+Number(n||0).toLocaleString('es-CO',{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtD=(d,o={weekday:'short',day:'numeric',month:'short'})=>new Intl.DateTimeFormat('es',o).format(new Date(d+'T12:00'));
const fmtDT=t=>new Intl.DateTimeFormat('es',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(t));
const AIR={MIA:'Miami',AXM:'Armenia',BAQ:'Barranquilla'};
const ROUTES=[['MIA-AXM','Miami → Armenia'],['AXM-MIA','Armenia → Miami'],['MIA-BAQ','Miami → Barranquilla (Carnaval)'],['BAQ-MIA','Barranquilla → Miami (Carnaval)']];
const FARE={classic:'Classic',flex:'Flex',bc:'Flex BC'};
const FARE_INFO={classic:'Equipaje de mano · económica',flex:'Maleta 23 kg · cambio sin cargo',bc:'Business · 2 maletas'};
const ST={pending:'Pendiente de pago',confirmed:'Emitida',cancelled:'Anulada',expired:'Vencida'};
const ZP={1:25,2:30,3:15,4:8,5:0}, ROWS=26, BIZ=3, COLS=['A','B','C','D','E','F'], EXIT=[13,14];
const isSeat=(r,c)=>!(r<=BIZ&&(c==='B'||c==='E'));
const zoneOf=r=>r<=BIZ?0:r<=6?1:EXIT.includes(r)?2:r<=12?3:r<=22?4:5;
const seatPrice=(fare,id)=>{const z=zoneOf(parseInt(id));if(!z||fare==='bc')return 0;const p=ZP[z];return fare==='flex'?(z>=3?0:p-ZP[3]):p};
const app=$('#app');
let token=sessionStorage.getItem('beemo-agt')||'', me=null;

async function api(path,opt={}){
  const r=await fetch('/api'+path,{method:opt.method||(opt.body?'POST':'GET'),headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:opt.body?JSON.stringify(opt.body):undefined});
  let j={}; try{j=await r.json()}catch(e){}
  if(r.status===401&&path!=='/auth/login'){token='';sessionStorage.removeItem('beemo-agt');me=null;boot();throw new Error(j.error||'Inicia sesión.')}
  if(!r.ok){const e=new Error(j.error||'No pudimos completar la solicitud.');e.data=j;e.status=r.status;throw e}
  return j;
}
const note=(el,msg,kind)=>{el.textContent=msg||'';el.className='note'+(kind?' '+kind:'');el.hidden=!msg};
function shell(tabs,cur,body){
  app.innerHTML=`<header class="top"><div class="wrap top-in"><a class="brand" href="/" aria-label="Beemo Air, portal de agencias"><svg class="wm" role="img" aria-label="Beemo Air"><use href="#wm"/></svg><span>Agencias</span></a>
   <nav class="tabs" aria-label="Secciones">${tabs.map(([k,t])=>`<a href="#${k}" ${k===cur?'aria-current="page"':''}>${t}</a>`).join('')}</nav>
   <div class="who"><span><b>${esc(me.agency?me.agency.name:'Beemo Air')}${me.agency&&me.agency.country?' · '+esc(me.agency.country):''}</b>${esc(me.name||me.email)}</span><button class="btn ghost sm" id="out">Salir</button></div></div></header>
   <main class="wrap main" id="main">${body}</main>`;
  $('#out').onclick=async()=>{try{await api('/auth/logout',{body:{}})}catch(e){} token='';sessionStorage.removeItem('beemo-agt');me=null;location.hash='';boot()};
}

/* ---------- login / setup / password ---------- */
async function viewLogin(){
  let setup=false; try{setup=(await api('/admin/setup')).needed}catch(e){}
  app.innerHTML=`<div class="login"><div class="login-card">
   <svg class="wm big" role="img" aria-label="Beemo Air"><use href="#wm"/></svg>
   <h1>Portal de agencias</h1><p class="muted">Reserva y emite vuelos de Beemo Air para tus clientes, con el mismo inventario de beemoair.com.</p>
   ${setup?`<form id="setupF" class="stack"><h2>Configura la cuenta de administrador</h2><label>Código de configuración<input name="code" autocomplete="off" required></label><label>Nombre<input name="name" autocomplete="name"></label><label>Correo<input name="email" type="email" autocomplete="email" required></label><label>Contraseña (mínimo 10 caracteres)<input name="password" type="password" autocomplete="new-password" required></label><p class="note" hidden></p><button class="btn lime">Crear administrador</button></form><hr>`:''}
   <form id="loginF" class="stack"><label>Correo<input name="email" type="email" autocomplete="username" required></label><label>Contraseña<input name="password" type="password" autocomplete="current-password" required></label><p class="note" hidden></p><button class="btn lime">Entrar</button></form>
   <p class="fine">¿Tu agencia aún no tiene acceso? Escríbenos a <a href="mailto:management@beemoair.com">management@beemoair.com</a>.</p></div></div>`;
  const lf=$('#loginF');
  lf.onsubmit=async e=>{e.preventDefault();const n=$('.note',lf);note(n,'');const d=Object.fromEntries(new FormData(lf));
    try{const r=await api('/auth/login',{body:d});token=r.token;sessionStorage.setItem('beemo-agt',token);me=r.user;boot()}catch(err){note(n,err.message,'err')}};
  const sf=$('#setupF'); if(sf) sf.onsubmit=async e=>{e.preventDefault();const n=$('.note',sf);const d=Object.fromEntries(new FormData(sf));
    try{await api('/admin/setup',{body:d});note(n,'Listo. Ya puedes entrar con ese correo y contraseña.','ok');sf.querySelector('button').disabled=true;lf.email.value=d.email}catch(err){note(n,err.message,'err')}};
}
function viewPassword(){
  app.innerHTML=`<div class="login"><div class="login-card"><svg class="wm big" role="img" aria-label="Beemo Air"><use href="#wm"/></svg><h1>Crea tu contraseña</h1><p class="muted">Entraste con una contraseña temporal. Elige una nueva de al menos 10 caracteres.</p>
   <form id="pwF" class="stack"><label>Nueva contraseña<input name="password" type="password" autocomplete="new-password" required minlength="10"></label><label>Repítela<input name="again" type="password" autocomplete="new-password" required></label><p class="note" hidden></p><button class="btn lime">Guardar y continuar</button></form></div></div>`;
  const f=$('#pwF');f.onsubmit=async e=>{e.preventDefault();const n=$('.note',f);if(f.password.value!==f.again.value)return note(n,'Las contraseñas no coinciden.','err');
    try{await api('/me/password',{body:{password:f.password.value}});me.must_change=false;boot()}catch(err){note(n,err.message,'err')}};
}

/* ---------- seat map ---------- */
function seatMap({fare,taken,mine,activePax,readOnly,names}){
  let h=`<div class="cabin" role="grid" aria-label="Mapa de asientos"><div class="row cols"><span>A</span><span>B</span><span>C</span><span></span><span>D</span><span>E</span><span>F</span></div>`;
  for(let r=1;r<=ROWS;r++){const z=zoneOf(r);h+=`<div class="row${r===BIZ+1?' gap':''}${EXIT.includes(r)?' exit':''}" role="row">`;
    COLS.forEach((c,ci)=>{if(ci===3)h+=`<span class="rn">${r}</span>`;if(!isSeat(r,c)){h+='<span></span>';return}
      const id=r+c, own=mine?mine.indexOf(id):-1, tk=taken.has(id)&&own<0, wrong=fare&&(fare==='bc'?r>BIZ:r<=BIZ);
      const cls=['seat',readOnly?'ro':'',r<=BIZ?'biz':'z'+z,own===activePax?'mine':own>=0?'other':'',wrong&&own<0?'blocked':''].join(' ');
      const lbl=`Asiento ${id}${tk?', ocupado':wrong?', otra cabina':own>=0?`, pasajero ${own+1}`:', libre'}${fare&&!tk&&!wrong?' · '+(seatPrice(fare,id)?'US$'+seatPrice(fare,id):'sin costo'):''}${names&&names[id]?' · '+names[id]:''}`;
      h+=`<button type="button" class="${cls}${tk&&readOnly?' sold':''}" data-seat="${id}" ${tk&&!readOnly||readOnly?'':''} ${readOnly?'tabindex="-1" aria-disabled="true"':(tk||wrong?'disabled':'')} title="${esc(lbl)}" aria-label="${esc(lbl)}">${own>=0?own+1:''}</button>`});
    h+='</div>'}
  return h+'</div>';
}

/* ---------- agent: new booking ---------- */
let NB=null;
function resetNB(){NB={route:'MIA-AXM',trip:'ow',pax:1,legs:[],sel:[],paxd:[],contact:{email:'',phone:''},seats:[],extras:[],pay:'cash',activeLeg:0,activePax:0}}
function viewNew(){
  if(!NB) resetNB();
  shell(agentTabs,'nueva',`<section class="card"><h1>Nueva reserva</h1>
   <form id="srch" class="srch"><label>Ruta<select name="route">${ROUTES.map(([k,t])=>`<option value="${k}" ${k===NB.route?'selected':''}>${t}</option>`).join('')}</select></label>
   <label>Viaje<select name="trip"><option value="ow" ${NB.trip==='ow'?'selected':''}>Solo ida</option><option value="rt" ${NB.trip==='rt'?'selected':''}>Ida y vuelta</option></select></label>
   <label>Pasajeros<select name="pax">${[1,2,3,4,5,6,7,8,9].map(n=>`<option ${n===NB.pax?'selected':''}>${n}</option>`).join('')}</select></label>
   <label>Desde<input type="date" name="from" value="${NB.from||new Date().toISOString().slice(0,10)}"></label>
   <button class="btn lime">Buscar vuelos</button></form><p class="note" id="srchN" hidden></p></section>
   <div id="nb"></div>`);
  const f=$('#srch');
  f.onsubmit=async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(f));const n=$('#srchN');note(n,'');
    NB.route=d.route;NB.trip=d.trip;NB.pax=+d.pax;NB.from=d.from;
    const [o,dd]=d.route.split('-'), routes=[d.route].concat(d.trip==='rt'?[dd+'-'+o]:[]);
    try{NB.legs=await Promise.all(routes.map(r=>api(`/agency/flights?route=${r}&from=${d.from}&n=10`)));NB.routes=routes;}catch(err){return note(n,err.message,'err')}
    if(NB.legs.some(l=>!l.length)) return note(n,'No hay vuelos para esa ruta desde la fecha elegida.','err');
    NB.sel=routes.map(()=>({date:null,fare:null}));NB.paxd=Array.from({length:NB.pax},(_,i)=>NB.paxd[i]||{first:'',last:'',inf:false});
    NB.seats=routes.map(()=>[]);NB.extras=routes.map(()=>[]);NB.taken=routes.map(()=>new Set());NB.activeLeg=0;NB.activePax=0;NB.done=null;
    renderNB()};
  if(NB.legs.length) renderNB();
}
function renderNB(){
  const box=$('#nb'); if(!box) return;
  const ready=NB.sel.length&&NB.sel.every(s=>s.date&&s.fare);
  let h=NB.routes.map((r,li)=>{const [o,d]=r.split('-');return `<section class="card"><h2>${li?'Vuelta':'Ida'}: ${AIR[o]} → ${AIR[d]}</h2><div class="flights">`+
    NB.legs[li].filter(f=>!NB.sel[li].fare||NB.sel[li].date===f.date).map(f=>{const seats=f.avail.eco+f.avail.biz;return `<div class="fl ${NB.sel[li].date===f.date?'on':''}"><div class="fl-h"><b>${fmtD(f.date,{weekday:'long',day:'numeric',month:'long'})}</b><span>${f.no} · ${f.dep}–${f.arr}</span><span class="avail ${seats<20?'low':''}">${seats} sillas libres · ${f.avail.biz} en Business</span></div>
      ${NB.sel[li].fare?`<button type="button" class="btn ghost sm chg" data-chgleg="${li}">Cambiar vuelo</button>`:''}<div class="fares">${['classic','flex','bc'].map(k=>{const soldOut=k==='bc'?f.avail.biz<NB.pax:f.avail.eco<NB.pax;return `<button type="button" class="fare" data-leg="${li}" data-date="${f.date}" data-fare="${k}" aria-pressed="${NB.sel[li].date===f.date&&NB.sel[li].fare===k}" ${soldOut?'disabled':''}><b>${FARE[k]}</b><span>${soldOut?'Agotado':money(f.prices[k])}</span><small>${FARE_INFO[k]}</small></button>`}).join('')}</div></div>`}).join('')+`</div></section>`}).join('');
  if(ready){
    h+=`<section class="card"><h2>Pasajeros</h2><p class="muted">Nombres tal como aparecen en el pasaporte.</p><div class="pax">`+NB.paxd.map((p,i)=>`<div class="paxrow"><span class="pn">${i+1}</span><label>Nombre<input data-p="${i}" data-k="first" value="${esc(p.first)}"></label><label>Apellido<input data-p="${i}" data-k="last" value="${esc(p.last)}"></label><label class="chk"><input type="checkbox" data-p="${i}" data-k="inf" ${p.inf?'checked':''}> Bebé en brazos (US$40 por trayecto)</label></div>`).join('')+
      `</div><div class="grid2"><label>Correo del cliente<input type="email" id="cEmail" value="${esc(NB.contact.email)}"></label><label>Teléfono del cliente<input id="cPhone" value="${esc(NB.contact.phone)}"></label></div></section>`;
    // seats
    const li=NB.activeLeg, s=NB.sel[li];
    h+=`<section class="card"><h2>Asientos <small>opcional</small></h2><p class="muted">Si no eliges, el sistema asigna una silla sin costo. Elige un pasajero y toca una silla libre.</p>
     ${NB.routes.length>1?`<div class="seg">${NB.routes.map((r,i)=>`<button type="button" data-legtab="${i}" aria-pressed="${i===li}">${i?'Vuelta':'Ida'} ${r.replace('-',' → ')}</button>`).join('')}</div>`:''}
     <div class="seatwrap"><div><ul class="plist">${NB.paxd.map((p,i)=>`<li><button type="button" data-ap="${i}" aria-pressed="${i===NB.activePax}"><span>${esc(p.first||'Pasajero')} ${esc(p.last||i+1)}</span><b>${NB.seats[li][i]||'—'}</b>${NB.seats[li][i]?`<small>${seatPrice(s.fare,NB.seats[li][i])?money(seatPrice(s.fare,NB.seats[li][i])):'sin costo'}</small>`:''}</button></li>`).join('')}</ul>
     <ul class="zones"><li><i class="z1"></i>Preferente 4–6 · US$25</li><li><i class="z2"></i>Salida 13–14 · US$30</li><li><i class="z3"></i>Delantera 7–12 · US$15</li><li><i class="z4"></i>Central 15–22 · US$8</li><li><i class="z5"></i>Trasera 23–26 · sin costo</li></ul><p class="fine">Flex incluye delantera y central; en preferente y salida paga la diferencia. Flex BC: Business incluido.</p></div>
     <div id="smap">${seatMap({fare:s.fare,taken:NB.taken[li],mine:NB.seats[li],activePax:NB.activePax})}</div></div></section>`;
    // extras
    h+=`<section class="card"><h2>Extras</h2><div class="xt"><table><thead><tr><th>Pasajero</th>${NB.routes.map((r,i)=>`<th colspan="3">${i?'Vuelta':'Ida'} · ${FARE[NB.sel[i].fare]}</th>`).join('')}</tr><tr><th></th>${NB.routes.map(()=>'<th>Maleta 23 kg<br><small>US$35</small></th><th>2.ª maleta<br><small>US$55</small></th><th>Prioritario<br><small>US$8</small></th>').join('')}</tr></thead><tbody>`+
      NB.paxd.map((p,i)=>`<tr><td>${esc(p.first||'Pasajero')} ${esc(p.last||i+1)}</td>${NB.routes.map((r,l)=>{const f=NB.sel[l].fare,x=NB.extras[l][i]||{};
        const cell=(k,st)=>`<td>${st==='inc'?'<span class="inc">Incluido</span>':st==='off'?'<span class="muted">—</span>':`<input type="checkbox" data-x="${k}" data-l="${l}" data-i="${i}" ${x[k]?'checked':''} aria-label="${k} pasajero ${i+1}">`}</td>`;
        return cell('bag',f!=='classic'?'inc':'opt')+cell('bag2',f==='bc'?'inc':f==='classic'&&!x.bag?'off':'opt')+cell('prio',f==='bc'?'inc':'opt')}).join('')}</tr>`).join('')+`</tbody></table></div></section>`;
    h+=`<section class="card"><h2>Pago</h2><div class="pay"><label class="opt"><input type="radio" name="pay" value="cash" ${NB.pay==='cash'?'checked':''}><span><b>Cobro en agencia</b><small>Tu agencia cobra al cliente. La reserva se emite de inmediato y el valor queda en tu saldo por consignar a Beemo Air cada semana.</small></span></label>
     <label class="opt"><input type="radio" name="pay" value="card" ${NB.pay==='card'?'checked':''}><span><b>Tarjeta del cliente</b><small>Se genera un enlace de pago seguro. Las sillas quedan apartadas hasta que se pague.</small></span></label></div>
     <div id="qbox" class="qbox"></div><p class="note" id="bookN" hidden></p><button class="btn lime big" id="bookBtn">Confirmar reserva</button></section>`;
  }
  box.innerHTML=h;
  $$('.fare',box).forEach(b=>b.onclick=()=>{const li=+b.dataset.leg;const prev=NB.sel[li].date;NB.sel[li]={date:b.dataset.date,fare:b.dataset.fare};if(prev!==b.dataset.date||true){NB.seats[li]=[];NB.extras[li]=[]}
    const next=d=>{const x=new Date(d+'T12:00:00Z');x.setUTCDate(x.getUTCDate()+1);return x.toISOString().slice(0,10)};
    const more=li===0&&NB.routes.length>1?api(`/agency/flights?route=${NB.routes[1]}&from=${next(NB.sel[0].date)}&n=10`).then(r=>{NB.legs[1]=r;if(NB.sel[1].date&&NB.sel[1].date<=NB.sel[0].date){NB.sel[1]={date:null,fare:null};NB.seats[1]=[];NB.extras[1]=[]}}).catch(()=>{}):Promise.resolve();
    Promise.all([loadTaken(li),more]).then(()=>{keep(renderNB);quote()})});
  $$('[data-chgleg]',box).forEach(b=>b.onclick=()=>{const li=+b.dataset.chgleg;NB.sel[li]={date:null,fare:null};NB.seats[li]=[];NB.extras[li]=[];if(li===0&&NB.sel[1]){NB.sel[1]={date:null,fare:null};NB.seats[1]=[];NB.extras[1]=[]}renderNB()});
  if(!ready) return;
  $$('[data-p]',box).forEach(x=>x.oninput=x.onchange=()=>{const p=NB.paxd[+x.dataset.p];if(x.type==='checkbox'){p.inf=x.checked;quote()}else{p[x.dataset.k]=x.value.trim()}});
  $('#cEmail').oninput=e=>NB.contact.email=e.target.value.trim(); $('#cPhone').oninput=e=>NB.contact.phone=e.target.value.trim();
  $$('[data-legtab]',box).forEach(b=>b.onclick=()=>{NB.activeLeg=+b.dataset.legtab;keep(renderNB)});
  $$('[data-ap]',box).forEach(b=>b.onclick=()=>{NB.activePax=+b.dataset.ap;keep(renderNB)});
  $$('#smap [data-seat]',box).forEach(b=>b.onclick=()=>{const li=NB.activeLeg,m=NB.seats[li],id=b.dataset.seat,ow=m.indexOf(id);if(ow>=0&&ow!==NB.activePax)return;
    m[NB.activePax]=ow===NB.activePax?undefined:id; if(m[NB.activePax]&&NB.activePax<NB.pax-1&&!m[NB.activePax+1])NB.activePax++; keep(renderNB); quote()});
  $$('[data-x]',box).forEach(c=>c.onchange=()=>{const l=+c.dataset.l,i=+c.dataset.i,x=NB.extras[l][i]=NB.extras[l][i]||{};x[c.dataset.x]=c.checked;if(c.dataset.x==='bag'&&!c.checked)x.bag2=false;keep(renderNB);quote()});
  $$('[name=pay]',box).forEach(r=>r.onchange=()=>{NB.pay=r.value});
  $('#bookBtn').onclick=book;
  quote();
}
function keep(fn){const y=scrollY;fn();scrollTo(0,y)}
async function loadTaken(li){const s=NB.sel[li];try{const r=await api(`/seats?route=${NB.routes[li]}&date=${s.date}`);NB.taken[li]=new Set(r.taken)}catch(e){NB.taken[li]=new Set()}}
function payload(){return{legs:NB.routes.map((r,i)=>({route:r,date:NB.sel[i].date,fare:NB.sel[i].fare,seats:NB.paxd.map((_,p)=>NB.seats[i][p]||null),extras:NB.paxd.map((_,p)=>NB.extras[i][p]||{})})),
  pax:NB.paxd.map(p=>({first:p.first||'X',last:p.last||'X',inf:p.inf})),contact:{email:NB.contact.email||'cotizacion@beemoair.com',phone:NB.contact.phone},pay:NB.pay}}
let qt=0;
async function quote(){const box=$('#qbox');if(!box)return;const my=++qt;
  try{const b=await api('/agency/quote',{body:payload()});if(my!==qt)return;
    box.innerHTML=`<table class="sum"><tr><td>Tarifas (${NB.pax} ${NB.pax>1?'pasajeros':'pasajero'}, impuestos incluidos)</td><td>${money(b.fares)}</td></tr>${b.seats?`<tr><td>Asientos</td><td>${money(b.seats)}</td></tr>`:''}${b.extras?`<tr><td>Extras</td><td>${money(b.extras)}</td></tr>`:''}${b.infants?`<tr><td>Bebés en brazos</td><td>${money(b.infants)}</td></tr>`:''}<tr class="tot"><td>Total a cobrar al cliente</td><td>${money(b.total)}</td></tr><tr class="com"><td>Tu comisión (${b.rate} % de la tarifa neta)</td><td>${money(b.commission)}</td></tr></table>`}
  catch(e){if(my===qt)box.innerHTML=`<p class="muted">${esc(e.message)}</p>`}}
async function book(){
  const n=$('#bookN');note(n,'');
  const miss=NB.paxd.findIndex(p=>!p.first||!p.last); if(miss>=0) return note(n,`Falta el nombre o el apellido del pasajero ${miss+1}.`,'err');
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(NB.contact.email)) return note(n,'Escribe el correo del cliente: ahí recibe su reserva.','err');
  const btn=$('#bookBtn');btn.disabled=true;btn.textContent='Reservando…';
  try{const r=await api('/agency/bookings',{body:payload()});NB.done=r;showDone(r);resetNB()}
  catch(e){note(n,e.message,'err');btn.disabled=false;btn.textContent='Confirmar reserva';
    if(e.data&&e.data.code==='seat_taken'){await Promise.all(NB.routes.map((_,i)=>loadTaken(i)));NB.routes.forEach((_,i)=>NB.seats[i]=NB.seats[i].map(s=>s&&NB.taken[i].has(s)?undefined:s));keep(renderNB);note($('#bookN'),e.message,'err')}}
}
function showDone(r){
  $('#main').innerHTML=`<section class="card done"><p class="kick">${r.status==='confirmed'?'Reserva emitida':'Reserva creada · pendiente de pago'}</p><p class="pnr">${r.pnr}</p>
   ${legsTable(r)}${r.status==='pending'?`<p>Las sillas quedan apartadas hasta el <b>${fmtDT(r.expires)}</b>. ${r.pay_url?'Envía este enlace de pago al cliente:':'La pasarela de pago aún no está activa: Beemo Air confirmará el pago manualmente.'}</p>${r.pay_url?`<div class="link"><input readonly value="${esc(r.pay_url)}"><button class="btn ghost sm" id="cp">Copiar</button></div>`:''}`:
   `<p>Total cobrado por tu agencia: <b>${money(r.total)}</b>. Queda en tu saldo por consignar.</p>`}
   <p class="muted">Tu comisión: ${money(r.commission)}.</p><div class="acts"><button class="btn lime" id="again">Nueva reserva</button><a class="btn ghost" href="#reservas">Ver mis reservas</a></div></section>`;
  $('#again').onclick=()=>viewNew(); const cp=$('#cp'); if(cp) cp.onclick=()=>{navigator.clipboard&&navigator.clipboard.writeText(r.pay_url);cp.textContent='Copiado'};
}
function legsTable(b){return `<table class="sum">${b.legs.map(l=>`<tr><td><b>${l.route.replace('-',' → ')}</b> · ${l.no}<br><span class="muted">${fmtD(l.date,{weekday:'long',day:'numeric',month:'long'})} · ${l.dep}–${l.arr} · ${FARE[l.fare]}</span></td><td>${l.seats.join(', ')}</td></tr>`).join('')}
  <tr><td colspan="2" class="muted">${b.pax.map(p=>esc(p.first+' '+p.last)+(p.inf?' (+ bebé)':'')).join(' · ')}</td></tr></table>`}

/* ---------- agent: bookings & statement ---------- */
async function viewBookings(){
  shell(agentTabs,'reservas',`<section class="card"><h1>Mis reservas</h1><div id="bl"><p class="muted">Cargando…</p></div></section>`);
  const list=await api('/agency/bookings'); const bl=$('#bl');
  if(!list.length){bl.innerHTML='<p class="muted">Aún no tienes reservas. <a href="#nueva">Crea la primera</a>.</p>';return}
  bl.innerHTML=`<div class="tw"><table class="tbl"><thead><tr><th>Código</th><th>Vuelo</th><th>Pasajeros</th><th>Total</th><th>Comisión</th><th>Pago</th><th>Estado</th><th></th></tr></thead><tbody>${list.map(b=>`<tr>
   <td><b>${b.pnr}</b><br><small class="muted">${fmtDT(b.created)}</small></td><td>${b.legs.map(l=>`${l.route.replace('-','→')} ${fmtD(l.date)}`).join('<br>')}</td><td>${b.pax.length}</td><td>${money(b.total)}</td><td>${money(b.commission)}</td>
   <td>${b.pay_method==='cash'?(b.settled?'Agencia · consignado':'Agencia · por consignar'):'Tarjeta'}</td><td><span class="st ${b.status}">${ST[b.status]}</span>${b.status==='pending'&&b.expires?`<br><small class="muted">hasta ${fmtDT(b.expires)}</small>`:''}</td>
   <td>${b.status==='pending'?`${b.pay_url?`<button class="btn ghost sm" data-cp="${esc(b.pay_url)}">Enlace</button> `:''}<button class="btn ghost sm" data-cancel="${b.pnr}">Anular</button>`:''}</td></tr>`).join('')}</tbody></table></div>`;
  $$('[data-cancel]',bl).forEach(b=>b.onclick=async()=>{if(!confirm(`¿Anular la reserva ${b.dataset.cancel}? Las sillas se liberan.`))return;try{await api(`/agency/bookings/${b.dataset.cancel}/cancel`,{body:{}});viewBookings()}catch(e){alert(e.message)}});
  $$('[data-cp]',bl).forEach(b=>b.onclick=()=>{navigator.clipboard&&navigator.clipboard.writeText(b.dataset.cp);b.textContent='Copiado'});
}
async function viewStatement(){
  shell(agentTabs,'cuenta',`<section class="card"><h1>Estado de cuenta</h1><div id="stm"><p class="muted">Cargando…</p></div></section>`);
  const s=await api('/agency/statement');
  $('#stm').innerHTML=`<ul class="kpis"><li><b>${s.bookings}</b><span>reservas emitidas</span></li><li><b>${money(s.sales)}</b><span>ventas totales</span></li><li><b>${money(s.commission)}</b><span>comisión causada (${me.agency.commission+me.agency.incentive} %)</span></li><li class="due"><b>${money(s.cash_due)}</b><span>por consignar a Beemo Air</span></li></ul>
   <p class="muted">La comisión es del ${me.agency.commission} % de la tarifa neta${me.agency.incentive?` más un incentivo del ${me.agency.incentive} %`:''}, sin impuestos, tasas ni extras. Se liquida cada mes. Lo cobrado en efectivo se consigna cada semana, a más tardar el segundo día hábil de la semana siguiente.</p>
   ${s.pending?`<p>Tienes ${s.pending} ${s.pending>1?'reservas pendientes':'reserva pendiente'} de pago.</p>`:''}`;
}
const agentTabs=[['nueva','Nueva reserva'],['reservas','Mis reservas'],['cuenta','Estado de cuenta']];

/* ---------- admin ---------- */
const adminTabs=[['vuelos','Vuelos'],['temporadas','Temporadas'],['reservas','Reservas'],['agencias','Agencias'],['pases','Pases'],['actividad','Actividad']];
async function viewFlights(){
  shell(adminTabs,'vuelos',`<section class="card"><h1>Vuelos e inventario</h1><div id="ov"><p class="muted">Cargando…</p></div></section><div id="man"></div>`);
  const o=await api('/admin/overview'); const all=sessionStorage.getItem('beemo-allf')==='1'; const shown=all?o.flights:o.flights.slice(0,20);
  $('#ov').innerHTML=`${o.stripe?'':'<p class="warn">La pasarela Stripe aún no está conectada: las reservas con tarjeta quedan pendientes y se confirman a mano con «Marcar pagada».</p>'}
   <div class="tw"><table class="tbl"><thead><tr><th>Fecha</th><th>Vuelo</th><th>Emitidas</th><th>Apartadas</th><th>Libres</th><th>Business libres</th><th>Ocupación</th><th></th></tr></thead><tbody>${shown.map(f=>{const occ=Math.round((f.sold+f.held)/150*100);return `<tr><td>${fmtD(f.date)}</td><td>${f.no} · ${f.route.replace('-','→')}</td><td>${f.sold}</td><td>${f.held}</td><td>${f.free}</td><td>${f.biz_free}</td><td><span class="bar"><i style="width:${occ}%"></i></span> ${occ} %</td><td><button class="btn ghost sm" data-man="${f.route}|${f.date}">Manifiesto</button></td></tr>`}).join('')}</tbody></table></div>${o.flights.length>20?`<button class="btn ghost sm" id="allf" style="margin-top:12px">${all?'Ver solo los próximos 20':'Ver los '+o.flights.length+' vuelos'}</button>`:''}`;
  const af=$('#allf'); if(af) af.onclick=()=>{sessionStorage.setItem('beemo-allf',all?'0':'1');viewFlights()};
  $$('[data-man]').forEach(b=>b.onclick=()=>manifest(...b.dataset.man.split('|')));
}
const SEASON_NAME={'2027-02-06':'Carnaval de Barranquilla','2027-02-10':'Carnaval de Barranquilla'};
async function viewSeasons(){
  shell(adminTabs,'temporadas',`<section class="card"><h1>Vuelos de temporada</h1><p class="muted">Cada vuelo de temporada se confirma si llega a 90 sillas vendidas 45 días antes de la salida; si no, se cancela sin costo.</p><div id="ss"><p class="muted">Cargando…</p></div></section><div id="man"></div>`);
  const list=await api('/admin/seasons');
  $('#ss').innerHTML=list.length?list.map(f=>{const pct=Math.min(100,Math.round(f.sold/f.min_seats*100)), ok=f.sold>=f.min_seats, late=f.days_to_deadline<0;
    const state=ok?['confirmed','Meta alcanzada']:late?['cancelled','Plazo vencido']:f.days_to_deadline<=14?['pending','En riesgo']:['pending','En venta'];
    return `<article class="season"><div class="ss-h"><div><p class="kick">${esc(SEASON_NAME[f.date]||'Vuelo de temporada')}</p><h2>${f.route.replace('-',' → ')} · ${f.no}</h2><p class="muted">${fmtD(f.date,{weekday:'long',day:'numeric',month:'long',year:'numeric'})} · ${f.dep}–${f.arr} · faltan ${f.days_to_flight} días</p></div><span class="st ${state[0]}">${state[1]}</span></div>
     <ul class="kpis sm"><li><b>${f.sold}</b><span>emitidas</span></li><li><b>${f.held}</b><span>apartadas sin pago</span></li><li><b>${f.free}</b><span>libres de 150</span></li><li class="due"><b>${money(f.revenue)}</b><span>tarifas emitidas</span></li></ul>
     <div class="goal"><div class="goal-t"><span><b>${f.sold} de ${f.min_seats}</b> sillas para confirmar el vuelo</span><span>${late?'El plazo venció el':'Plazo:'} ${fmtD(f.deadline,{day:'numeric',month:'long'})}${late?'':` · ${f.days_to_deadline} días`}</span></div><span class="bar wide"><i style="width:${pct}%"></i></span></div>
     ${f.channels.length?`<table class="tbl"><thead><tr><th>Canal</th><th>Emitidas</th><th>Apartadas</th></tr></thead><tbody>${f.channels.map(c=>`<tr><td>${esc(c.name)}</td><td>${c.sold}</td><td>${c.held}</td></tr>`).join('')}</tbody></table>`:'<p class="muted">Todavía no hay ventas en este vuelo.</p>'}
     <button class="btn ghost sm" data-man="${f.route}|${f.date}">Ver manifiesto</button></article>`}).join(''):'<p class="muted">No hay vuelos de temporada programados.</p>';
  $$('[data-man]').forEach(b=>b.onclick=()=>manifest(...b.dataset.man.split('|')));
}
async function manifest(route,date){
  const rows=await api(`/admin/manifest?route=${route}&date=${date}`);const names={};rows.forEach(r=>names[r.seat]=r.name);
  $('#man').innerHTML=`<section class="card"><h2>Manifiesto ${route.replace('-',' → ')} · ${fmtD(date,{weekday:'long',day:'numeric',month:'long'})}</h2><div class="mwrap"><div class="tw"><table class="tbl"><thead><tr><th>Silla</th><th>Pasajero</th><th>Tarifa</th><th>Reserva</th><th>Canal</th><th>Estado</th></tr></thead><tbody>${rows.map(r=>`<tr><td><b>${r.seat}</b></td><td>${esc(r.name)}${r.inf?' + bebé':''}${Object.keys(r.extras).length?`<br><small class="muted">${Object.keys(r.extras).map(k=>({bag:'maleta',bag2:'2.ª maleta',prio:'prioritario'})[k]).join(', ')}</small>`:''}</td><td>${r.fare}</td><td>${r.pnr}</td><td>${esc(r.channel)}</td><td><span class="st ${r.status}">${ST[r.status]}</span></td></tr>`).join('')||'<tr><td colspan="6" class="muted">Sin pasajeros todavía.</td></tr>'}</tbody></table></div>
   <div>${seatMap({taken:new Set(rows.map(r=>r.seat)),readOnly:true,names})}</div></div></section>`;
  $('#man').scrollIntoView({behavior:'smooth'});
}
async function viewAdminBookings(){
  const stF=sessionStorage.getItem('beemo-stf')||'';
  shell(adminTabs,'reservas',`<section class="card"><h1>Reservas</h1><label class="inline">Estado <select id="stf"><option value="">Todas</option>${Object.entries(ST).map(([k,v])=>`<option value="${k}" ${k===stF?'selected':''}>${v}</option>`).join('')}</select></label><div id="abl"><p class="muted">Cargando…</p></div></section>`);
  $('#stf').onchange=e=>{sessionStorage.setItem('beemo-stf',e.target.value);viewAdminBookings()};
  const list=await api('/admin/bookings'+(stF?'?status='+stF:''));
  $('#abl').innerHTML=list.length?`<div class="tw"><table class="tbl"><thead><tr><th>Código</th><th>Canal</th><th>Vuelo</th><th>Pasajeros</th><th>Total</th><th>Pago</th><th>Estado</th><th></th></tr></thead><tbody>${list.map(b=>`<tr>
   <td><b>${b.pnr}</b><br><small class="muted">${fmtDT(b.created)}</small></td><td>${esc(b.agency||'beemoair.com')}</td><td>${b.legs.map(l=>`${l.route.replace('-','→')} ${fmtD(l.date)}`).join('<br>')}</td>
   <td>${b.pax.map(p=>esc(p.first+' '+p.last)).join('<br>')}<br><small class="muted">${esc(b.contact.email)}</small></td><td>${money(b.total)}${b.due&&b.status!=='pending'?`<br><small class="muted">extras por cobrar ${money(b.due)}</small>`:''}</td>
   <td>${b.pay_method==='cash'?(b.settled?'Agencia · consignado':'Agencia · por consignar'):'Tarjeta'}</td><td><span class="st ${b.status}">${ST[b.status]}</span>${b.status==='pending'&&b.expires?`<br><small class="muted">hasta ${fmtDT(b.expires)}</small>`:''}</td>
   <td class="acts">${b.status==='pending'||b.due?`<button class="btn ghost sm" data-a="paid" data-p="${b.pnr}">Marcar pagada</button>`:''}${b.pay_method==='cash'&&b.status==='confirmed'&&!b.settled?`<button class="btn ghost sm" data-a="settle" data-p="${b.pnr}">Consignado</button>`:''}${['pending','confirmed'].includes(b.status)?`<button class="btn ghost sm danger" data-a="cancel" data-p="${b.pnr}">Anular</button>`:''}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">No hay reservas con ese estado.</p>';
  $$('[data-a]').forEach(b=>b.onclick=async()=>{const t={paid:'marcar como pagada',settle:'marcar como consignada',cancel:'anular (las sillas se liberan)'}[b.dataset.a];
    if(!confirm(`¿Seguro que quieres ${t} la reserva ${b.dataset.p}?`))return;try{await api(`/admin/bookings/${b.dataset.p}/${b.dataset.a}`,{body:{}});viewAdminBookings()}catch(e){alert(e.message)}});
}
async function viewAgencies(){
  shell(adminTabs,'agencias',`<section class="card"><h1>Agencias</h1><form id="newAg" class="srch"><label>Nombre de la agencia<input name="name" required></label><label>País<select name="country" required><option value="">Elige…</option><option>Colombia</option><option>Estados Unidos</option><option>Otro</option></select></label><label>Ciudad<input name="city"></label><label>NIT / EIN<input name="tax_id"></label><label>Contacto<input name="contact"></label><label>Correo<input name="email" type="email"></label><label>Teléfono<input name="phone"></label><label>Comisión %<input name="commission" type="number" step="0.5" min="0" max="30" value="3"></label><label>Incentivo %<input name="incentive" type="number" step="0.5" min="0" max="30" value="0"></label><button class="btn lime">Crear agencia</button></form><p class="note" id="agN" hidden></p></section><div id="agl"></div>`);
  $('#newAg').onsubmit=async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.target));try{await api('/admin/agencies',{body:d});viewAgencies()}catch(err){note($('#agN'),err.message,'err')}};
  const list=await api('/admin/agencies');
  $('#agl').innerHTML=list.map(a=>`<section class="card ag ${a.active?'':'off'}"><div class="ag-h"><h2>${esc(a.name)}</h2><span class="ctry">${a.country==='Colombia'?'🇨🇴':a.country==='Estados Unidos'?'🇺🇸':'🌐'} ${esc(a.country||'Sin país')}</span><span class="st ${a.active?'confirmed':'cancelled'}">${a.active?'Activa':'Inactiva'}</span></div>
   <p class="ag-d muted">${[a.city,a.tax_id,a.address,a.contact,a.email,a.phone].filter(Boolean).map(esc).join(' · ')}</p>
   <ul class="kpis sm"><li><b>${a.statement.bookings}</b><span>emitidas</span></li><li><b>${money(a.statement.sales)}</b><span>ventas</span></li><li><b>${money(a.statement.commission)}</b><span>comisión</span></li><li class="due"><b>${money(a.statement.cash_due)}</b><span>por consignar</span></li></ul>
   <form class="srch" data-ag="${a.id}"><label>Comisión %<input name="commission" type="number" step="0.5" min="0" max="30" value="${a.commission}"></label><label>Incentivo %<input name="incentive" type="number" step="0.5" min="0" max="30" value="${a.incentive}"></label><button class="btn ghost">Guardar</button><button type="button" class="btn ghost" data-toggle="${a.id}" data-on="${a.active?1:0}">${a.active?'Desactivar agencia':'Activar agencia'}</button></form>
   <h3>Usuarios</h3><ul class="users">${a.users.map(u=>`<li><span><b>${esc(u.name||u.email)}</b> ${esc(u.email)}${u.must_change?' · <small class="muted">debe cambiar la contraseña</small>':''}${u.active?'':' · <small class="muted">desactivado</small>'}</span><span><button class="btn ghost sm" data-reset="${u.id}">Nueva contraseña temporal</button> <button class="btn ghost sm" data-ut="${u.id}">${u.active?'Desactivar':'Activar'}</button></span></li>`).join('')||'<li class="muted">Esta agencia todavía no tiene usuarios. Agrega el primero abajo con su correo: el portal te dará su contraseña temporal, y desde ese momento verás aquí los botones «Nueva contraseña temporal» y «Desactivar».</li>'}</ul>
   <form class="srch" data-nu="${a.id}"><label>Nombre<input name="name"></label><label>Correo<input name="email" type="email" required></label><button class="btn ghost">Agregar usuario</button></form><p class="note" data-un="${a.id}" hidden></p></section>`).join('');
  $$('[data-ag]').forEach(f=>f.onsubmit=async e=>{e.preventDefault();await api('/admin/agencies/'+f.dataset.ag,{method:'PATCH',body:Object.fromEntries(new FormData(f))});viewAgencies()});
  $$('[data-toggle]').forEach(b=>b.onclick=async()=>{await api('/admin/agencies/'+b.dataset.toggle,{method:'PATCH',body:{active:b.dataset.on!=='1'}});viewAgencies()});
  const showPw=(id,r)=>note($(`[data-un="${id}"]`),`Contraseña temporal de ${r.email}: ${r.temp_password} — compártela por un canal seguro. Se pedirá cambiarla al entrar y no se vuelve a mostrar.`,'ok');
  $$('[data-nu]').forEach(f=>f.onsubmit=async e=>{e.preventDefault();try{const r=await api(`/admin/agencies/${f.dataset.nu}/users`,{body:Object.fromEntries(new FormData(f))});await viewAgencies();showPw(f.dataset.nu,r)}catch(err){note($(`[data-un="${f.dataset.nu}"]`),err.message,'err')}});
  $$('[data-reset]').forEach(b=>b.onclick=async()=>{if(!confirm('¿Generar una nueva contraseña temporal? La actual deja de funcionar.'))return;const id=b.closest('.ag').querySelector('[data-nu]').dataset.nu;const r=await api(`/admin/users/${b.dataset.reset}/reset`,{body:{}});await viewAgencies();showPw(id,r)});
  $$('[data-ut]').forEach(b=>b.onclick=async()=>{await api(`/admin/users/${b.dataset.ut}/toggle`,{body:{}});viewAgencies()});
}
const PST={active:'Publicado',soon:'Próximamente',inactive:'Oculto'};
const RLBL={'MIA-AXM':'Miami → Armenia','AXM-MIA':'Armenia → Miami','MIA-BAQ':'Miami → Barranquilla','BAQ-MIA':'Barranquilla → Miami'};
let PEDIT=null;
async function viewPasses(){
  shell(adminTabs,'pases',`<section class="card"><div class="hd"><h1>Tipos de pase</h1><button class="btn lime" id="pNew">Crear pase</button></div>
   <p class="muted">Lo publicado aparece en beemoair.com/pase-de-temporada y en el home; lo marcado como «Próximamente» se muestra sin botón de compra; lo oculto no se ve en la web.</p>
   <div id="pForm"></div><div id="pp"><p class="muted">Cargando…</p></div></section>
   <section class="card"><h2>Pases vendidos</h2><div id="pl"><p class="muted">Cargando…</p></div></section>`);
  const [prods,list]=await Promise.all([api('/admin/pass-products'),api('/admin/passes')]);
  $('#pNew').onclick=()=>{PEDIT={status:'inactive',valid_months:12,routes:['MIA-AXM','AXM-MIA'],sort:100};passForm()};
  $('#pp').innerHTML=prods.length?`<div class="tw"><table class="tbl"><thead><tr><th>Pase</th><th>Trayectos</th><th>Precio</th><th>Rutas</th><th>Vigencia</th><th>Vendidos</th><th>Estado</th><th></th></tr></thead><tbody>${prods.map(p=>`<tr>
    <td><b>${esc(p.name)}</b>${p.badge?` <span class="st confirmed">${esc(p.badge)}</span>`:''}<br><small class="muted">${esc(p.description||'')}</small></td>
    <td>${p.segments??'—'}</td><td>${p.price?money(p.price):'—'}${p.per_segment?`<br><small class="muted">${money(p.per_segment)} c/u · ahorra US$${p.savings}</small>`:''}</td>
    <td>${p.routes.map(r=>RLBL[r]||r).join('<br>')||'—'}</td><td>${p.valid_months} meses</td><td>${p.sold}</td>
    <td><select data-pst="${p.id}" aria-label="Estado de ${esc(p.name)}">${Object.entries(PST).map(([k,v])=>`<option value="${k}" ${k===p.status?'selected':''}>${v}</option>`).join('')}</select></td>
    <td class="acts"><button class="btn ghost sm" data-pe="${p.id}">Editar</button><button class="btn ghost sm" data-pc="${p.id}">Clonar</button></td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">No hay tipos de pase.</p>';
  $$('[data-pst]').forEach(sel=>sel.onchange=async()=>{try{await api('/admin/pass-products/'+sel.dataset.pst,{method:'PATCH',body:{status:sel.value}});viewPasses()}catch(e){alert(e.message);viewPasses()}});
  $$('[data-pe]').forEach(b=>b.onclick=()=>{PEDIT=prods.find(p=>p.id===+b.dataset.pe);passForm()});
  $$('[data-pc]').forEach(b=>b.onclick=async()=>{const r=await api(`/admin/pass-products/${b.dataset.pc}/clone`,{body:{}});const all=await api('/admin/pass-products');PEDIT=all.find(p=>p.id===r.id);await viewPasses()});
  if(PEDIT) passForm();
  $('#pl').innerHTML=list.length?`<div class="tw"><table class="tbl"><thead><tr><th>Código</th><th>Pase</th><th>Cliente</th><th>Trayectos</th><th>Precio</th><th>Vence</th><th>Estado</th><th></th></tr></thead><tbody>${list.map(p=>`<tr><td><b>${p.code}</b><br><small class="muted">${fmtDT(p.created)}</small></td><td>${esc(p.product)}</td><td>${esc(p.name)}<br><small class="muted">${esc(p.email)}</small></td><td>${p.left} de ${p.total}</td><td>${money(p.price)}</td><td>${fmtD(p.exp,{day:'numeric',month:'short',year:'numeric'})}</td><td><span class="st ${p.status==='paid'?'confirmed':p.status}">${{pending:'Pendiente de pago',paid:'Pagado',expired:'Vencido'}[p.status]||p.status}</span></td><td>${p.status!=='paid'?`<button class="btn ghost sm" data-pp="${p.code}">Marcar pagado</button>`:''}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">Todavía no hay pases vendidos.</p>';
  $$('[data-pp]').forEach(b=>b.onclick=async()=>{if(!confirm(`¿Marcar el pase ${b.dataset.pp} como pagado?`))return;await api(`/admin/passes/${b.dataset.pp}/paid`,{body:{}});viewPasses()});
}
function passForm(){
  const p=PEDIT, box=$('#pForm'); if(!box) return;
  box.innerHTML=`<form id="pf" class="pform"><h2>${p.id?'Editar pase':'Nuevo pase'}</h2>
   <div class="pf-grid">
    <label>Nombre (español)<input name="name" value="${esc(p.name||'')}" required></label><label>Nombre (inglés)<input name="name_en" value="${esc(p.name_en||'')}"></label>
    <label>Descripción (español)<input name="description" value="${esc(p.description||'')}"></label><label>Descripción (inglés)<input name="description_en" value="${esc(p.description_en||'')}"></label>
    <label>Etiqueta (opcional)<input name="badge" value="${esc(p.badge||'')}" placeholder="Más ahorro"></label><label>Etiqueta (inglés)<input name="badge_en" value="${esc(p.badge_en||'')}"></label>
    <label>Trayectos<input name="segments" type="number" min="1" max="40" value="${p.segments??''}"></label><label>Precio total (US$, impuestos incluidos)<input name="price" type="number" min="1" step="0.01" value="${p.price??''}"></label>
    <label>Vigencia (meses)<input name="valid_months" type="number" min="1" max="36" value="${p.valid_months||12}"></label><label>Orden en la web<input name="sort" type="number" value="${p.sort??100}"></label>
   </div>
   <fieldset class="rts"><legend>Rutas donde sirve</legend>${Object.entries(RLBL).map(([k,v])=>`<label class="chk"><input type="checkbox" name="routes" value="${k}" ${(p.routes||[]).includes(k)?'checked':''}> ${v}</label>`).join('')}</fieldset>
   <label>Estado<select name="status">${Object.entries(PST).map(([k,v])=>`<option value="${k}" ${k===p.status?'selected':''}>${v}</option>`).join('')}</select></label>
   <p class="fine" id="pfCalc"></p><p class="note" hidden></p>
   <div class="acts"><button class="btn lime">${p.id?'Guardar cambios':'Crear pase'}</button><button type="button" class="btn ghost" id="pfX">Cancelar</button></div></form>`;
  const f=$('#pf'), calc=()=>{const n=+f.segments.value,pr=+f.price.value;$('#pfCalc').textContent=n&&pr?`${money(pr/n)} por trayecto · el cliente ahorra US$${Math.max(0,Math.round(395*n-pr))} frente a ${n} tiquetes Classic de US$395.`:''};
  f.segments.oninput=f.price.oninput=calc; calc();
  $('#pfX').onclick=()=>{PEDIT=null;box.innerHTML=''};
  f.onsubmit=async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(f));d.routes=$$('[name=routes]:checked',f).map(x=>x.value);
    try{if(p.id) await api('/admin/pass-products/'+p.id,{method:'PATCH',body:d}); else await api('/admin/pass-products',{body:d}); PEDIT=null; viewPasses()}catch(err){note($('.note',f),err.message,'err')}};
  box.scrollIntoView({behavior:'smooth',block:'start'});
}
async function viewLog(){
  shell(adminTabs,'actividad',`<section class="card"><h1>Actividad</h1><div id="lg"></div></section>`);
  const l=await api('/admin/log');$('#lg').innerHTML=`<div class="tw"><table class="tbl"><tbody>${l.map(x=>`<tr><td class="muted">${fmtDT(x.at)}</td><td>${esc(x.who||'')}</td><td>${esc(x.what)}</td></tr>`).join('')}</tbody></table></div>`;
}

/* ---------- router ---------- */
async function boot(){
  if(!token){return viewLogin()}
  if(!me){try{me=await api('/me')}catch(e){return}}
  if(me.must_change) return viewPassword();
  const h=location.hash.slice(1);
  try{
    if(me.role==='admin'){({vuelos:viewFlights,temporadas:viewSeasons,reservas:viewAdminBookings,agencias:viewAgencies,pases:viewPasses,actividad:viewLog}[h]||viewFlights)()}
    else{({nueva:viewNew,reservas:viewBookings,cuenta:viewStatement}[h]||viewNew)()}
  }catch(e){console.error(e)}
}
window.addEventListener('hashchange',boot);
window.addEventListener('unhandledrejection',e=>{const m=$('#main');if(m&&e.reason&&e.reason.message){const p=document.createElement('p');p.className='note err';p.textContent=e.reason.message;m.prepend(p)}});
boot();
})();
