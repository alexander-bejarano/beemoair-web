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
const FARE={light:'Light',basic:'Basic',classic:'Classic',plus:'Plus',flex:'Flex',bc:'Flex BC'}, FARE_KEYS=Object.keys(FARE), FRANK={light:0,basic:1,classic:2,plus:3,flex:4,bc:5};
const SEAT_INC=f=>['plus','flex','bc'].includes(f), NO_BAG=f=>['light','basic'].includes(f);
const FARE_INFO={light:'Solo artículo personal 6 kg · sin cambios',basic:'Mano 10 kg · cambio US$175',classic:'Mano 10 kg + maleta 23 kg · cambio US$175',plus:'Maleta 23 kg · asiento incluido · 1 cambio',flex:'Maleta 30 kg · asiento · cambios sin cargo',bc:'Business · 2 maletas 30 kg · sin cargo'};
const ST={pending:'Pendiente de pago',confirmed:'Emitida',cancelled:'Anulada',expired:'Vencida'};
const ZP={1:25,2:30,3:15,4:12,5:0}, ROWS=26, BIZ=3, COLS=['A','B','C','D','E','F'], EXIT=[13,14];
const isSeat=(r,c)=>!(r<=BIZ&&(c==='B'||c==='E'));
const zoneOf=r=>r<=BIZ?0:r<=6?1:EXIT.includes(r)?2:r<=12?3:r<=22?4:5;
const seatPrice=(fare,id)=>{const z=zoneOf(parseInt(id));if(!z||SEAT_INC(fare))return 0;return ZP[z]};
const app=$('#app');
let token=sessionStorage.getItem('beemo-agt')||'', me=null;
// vista de agencia abierta desde el administrador: llega como #as=TOKEN
if(location.hash.startsWith('#as=')){token=location.hash.slice(4);sessionStorage.setItem('beemo-agt',token);history.replaceState(null,'',location.pathname+'#inicio')}
const BG='<div class="pbg" aria-hidden="true"><svg class="scene" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMax slice" aria-hidden="true"><defs><linearGradient id="skyG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--sk1)"/><stop offset=".55" stop-color="var(--sk2)"/><stop offset="1" stop-color="var(--sk3)"/></linearGradient><radialGradient id="glowG" cx=".62" cy=".52" r=".42"><stop offset="0" stop-color="var(--glow)" stop-opacity=".55"/><stop offset="1" stop-color="var(--glow)" stop-opacity="0"/></radialGradient><filter id="sb1" x="-5%" y="-20%" width="110%" height="140%"><feGaussianBlur stdDeviation="14"/></filter><filter id="sb2" x="-5%" y="-20%" width="110%" height="140%"><feGaussianBlur stdDeviation="7"/></filter><filter id="sb3" x="-5%" y="-20%" width="110%" height="140%"><feGaussianBlur stdDeviation="3"/></filter></defs><rect width="1600" height="1000" fill="url(#skyG)"/><rect width="1600" height="1000" fill="url(#glowG)"/><path d="M-40,1020 L-40,478 L-24,482 L-8,487 L8,493 L24,499 L40,505 L56,512 L72,518 L88,524 L104,529 L120,533 L136,536 L152,538 L168,538 L184,537 L200,536 L216,533 L232,530 L248,526 L264,523 L280,519 L296,517 L312,514 L328,513 L344,512 L360,512 L376,513 L392,515 L408,517 L424,519 L440,522 L456,524 L472,526 L488,528 L504,530 L520,531 L536,531 L552,531 L568,531 L584,530 L600,530 L616,530 L632,531 L648,532 L664,535 L680,538 L696,543 L712,549 L728,556 L744,564 L760,573 L776,582 L792,592 L808,602 L824,611 L840,620 L856,628 L872,635 L888,641 L904,645 L920,648 L936,650 L952,651 L968,651 L984,650 L1000,649 L1016,648 L1032,646 L1048,645 L1064,644 L1080,643 L1096,643 L1112,643 L1128,643 L1144,644 L1160,644 L1176,644 L1192,643 L1208,642 L1224,640 L1240,638 L1256,634 L1272,629 L1288,623 L1304,617 L1320,610 L1336,603 L1352,596 L1368,589 L1384,583 L1400,577 L1416,572 L1432,569 L1448,567 L1464,566 L1480,566 L1496,567 L1512,570 L1528,573 L1544,576 L1560,579 L1576,583 L1592,586 L1608,588 L1624,589 L1640,590 L1640,1020 Z" fill="var(--m1)" filter="url(#sb1)"/><path d="M-40,1020 L-40,638 L-24,645 L-8,651 L8,656 L24,661 L40,665 L56,669 L72,674 L88,679 L104,684 L120,690 L136,697 L152,704 L168,710 L184,717 L200,722 L216,727 L232,730 L248,731 L264,731 L280,729 L296,726 L312,722 L328,717 L344,711 L360,706 L376,701 L392,698 L408,695 L424,695 L440,695 L456,698 L472,701 L488,706 L504,711 L520,716 L536,721 L552,725 L568,729 L584,731 L600,733 L616,733 L632,733 L648,732 L664,731 L680,730 L696,729 L712,729 L728,729 L744,730 L760,731 L776,733 L792,734 L808,736 L824,736 L840,735 L856,733 L872,729 L888,723 L904,716 L920,706 L936,695 L952,683 L968,671 L984,658 L1000,646 L1016,634 L1032,623 L1048,614 L1064,607 L1080,601 L1096,597 L1112,593 L1128,591 L1144,589 L1160,588 L1176,586 L1192,584 L1208,582 L1224,580 L1240,577 L1256,574 L1272,571 L1288,569 L1304,568 L1320,567 L1336,568 L1352,571 L1368,575 L1384,580 L1400,586 L1416,593 L1432,601 L1448,608 L1464,615 L1480,621 L1496,625 L1512,628 L1528,629 L1544,629 L1560,627 L1576,625 L1592,621 L1608,617 L1624,613 L1640,609 L1640,1020 Z" fill="var(--m2)" filter="url(#sb2)"/><path d="M-40,1020 L-40,862 L-24,861 L-8,860 L8,859 L24,858 L40,858 L56,858 L72,858 L88,858 L104,858 L120,856 L136,855 L152,853 L168,851 L184,849 L200,848 L216,849 L232,850 L248,851 L264,853 L280,853 L296,853 L312,850 L328,846 L344,840 L360,833 L376,825 L392,817 L408,810 L424,804 L440,799 L456,795 L472,792 L488,789 L504,786 L520,784 L536,781 L552,779 L568,778 L584,778 L600,780 L616,783 L632,788 L648,793 L664,800 L680,805 L696,810 L712,814 L728,815 L744,815 L760,814 L776,811 L792,809 L808,806 L824,804 L840,803 L856,802 L872,801 L888,799 L904,798 L920,795 L936,792 L952,789 L968,786 L984,784 L1000,782 L1016,782 L1032,782 L1048,784 L1064,785 L1080,785 L1096,785 L1112,782 L1128,777 L1144,771 L1160,763 L1176,754 L1192,745 L1208,736 L1224,727 L1240,720 L1256,712 L1272,706 L1288,699 L1304,692 L1320,686 L1336,679 L1352,673 L1368,667 L1384,663 L1400,661 L1416,661 L1432,663 L1448,667 L1464,671 L1480,676 L1496,681 L1512,684 L1528,686 L1544,687 L1560,687 L1576,687 L1592,687 L1608,687 L1624,688 L1640,690 L1640,1020 Z" fill="var(--m3)" filter="url(#sb3)"/><path d="M-40,1020 L-40,823 L-24,821 L-8,821 L8,822 L24,824 L40,828 L56,834 L72,841 L88,850 L104,858 L120,867 L136,875 L152,882 L168,889 L184,894 L200,899 L216,903 L232,906 L248,910 L264,913 L280,916 L296,920 L312,923 L328,926 L344,929 L360,932 L376,933 L392,933 L408,932 L424,930 L440,927 L456,922 L472,918 L488,914 L504,910 L520,907 L536,905 L552,904 L568,905 L584,907 L600,910 L616,913 L632,916 L648,919 L664,921 L680,922 L696,922 L712,922 L728,921 L744,919 L760,917 L776,915 L792,914 L808,913 L824,911 L840,910 L856,909 L872,906 L888,903 L904,899 L920,894 L936,887 L952,879 L968,871 L984,861 L1000,852 L1016,844 L1032,836 L1048,830 L1064,825 L1080,822 L1096,820 L1112,819 L1128,820 L1144,821 L1160,823 L1176,824 L1192,826 L1208,827 L1224,828 L1240,829 L1256,830 L1272,831 L1288,833 L1304,836 L1320,840 L1336,844 L1352,848 L1368,853 L1384,858 L1400,861 L1416,864 L1432,866 L1448,867 L1464,866 L1480,864 L1496,862 L1512,859 L1528,856 L1544,854 L1560,853 L1576,853 L1592,854 L1608,856 L1624,860 L1640,864 L1640,1020 Z" fill="var(--m4)"/></svg></div>';
// fondos del portal: paisaje suave detrás del vidrio; se guarda por navegador
const SCENES=[['dusk','Atardecer'],['cafe','Eje Cafetero'],['mar','Caribe']];
function getScene(){try{const s=localStorage.getItem('beemo-scene');if(SCENES.some(x=>x[0]===s))return s}catch(e){}return 'dusk'}
function setScene(s){SCENES.forEach(([k])=>document.body.classList.toggle('sc-'+k,k===s));try{localStorage.setItem('beemo-scene',s)}catch(e){}$$('[data-scene]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.scene===s)))}
setScene(getScene());
const SCENE_SW=()=>`<div class="scsw"><button type="button" class="scbtn" aria-label="Fondo" title="Fondo" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 18l5.5-6 4 4 3-3L21 18"/><circle cx="16" cy="8" r="2"/><rect x="3" y="4" width="18" height="16" rx="3"/></svg></button><div class="scpop" role="group" aria-label="Fondo" hidden>${SCENES.map(([k,t])=>`<button type="button" data-scene="${k}" aria-pressed="${k===getScene()}"><i class="scdot sc-${k}"></i>${t}</button>`).join('')}</div></div>`;
function bindScene(){$$('.scsw').forEach(w=>{const b=$('.scbtn',w),p=$('.scpop',w);b.onclick=e=>{e.stopPropagation();p.hidden=!p.hidden;b.setAttribute('aria-expanded',String(!p.hidden))};$$('[data-scene]',w).forEach(x=>x.onclick=()=>{setScene(x.dataset.scene);p.hidden=true;b.setAttribute('aria-expanded','false')})});document.addEventListener('click',e=>{if(!e.target.closest('.scsw'))$$('.scpop').forEach(p=>{p.hidden=true})})}
function getTheme(){try{const t=localStorage.getItem('beemo-theme');if(t==='dark'||t==='light')return t}catch(e){}return matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'}
function setTheme(t){document.body.classList.toggle('bd-dark',t==='dark');document.body.classList.toggle('bd-light',t==='light');try{localStorage.setItem('beemo-theme',t)}catch(e){}
  $$('[data-theme-btn]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.themeBtn===t)));window.dispatchEvent(new CustomEvent('beemo-theme',{detail:t}))}
const THEME_SW=()=>`<div class="tsw" role="group" aria-label="Modo de color"><button type="button" data-theme-btn="light" aria-label="Modo claro" title="Modo claro"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/></svg></button><button type="button" data-theme-btn="dark" aria-label="Modo oscuro" title="Modo oscuro"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/></svg></button></div>`;
function bindTheme(){bindScene();$$('[data-theme-btn]').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.themeBtn===getTheme()));b.onclick=()=>setTheme(b.dataset.themeBtn)})}
setTheme(getTheme());

async function api(path,opt={}){
  const r=await fetch('/api'+path,{method:opt.method||(opt.body?'POST':'GET'),headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:opt.body?JSON.stringify(opt.body):undefined});
  let j={}; try{j=await r.json()}catch(e){}
  if(r.status===401&&path!=='/auth/login'){token='';sessionStorage.removeItem('beemo-agt');me=null;boot();throw new Error(j.error||'Inicia sesión.')}
  if(!r.ok){const e=new Error(j.error||'No pudimos completar la solicitud.');e.data=j;e.status=r.status;throw e}
  return j;
}
const note=(el,msg,kind)=>{el.textContent=msg||'';el.className='note'+(kind?' '+kind:'');el.hidden=!msg};
// texto sin tildes ni mayúsculas, para buscar
const normTxt=t=>String(t??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
// descarga un CSV que Excel abre bien (con BOM); las celdas que empiezan por = + - @ se neutralizan
function csvDownload(name,rows){
  const cell=c=>{if(typeof c==='number')return String(c);const t=String(c??'');return /^[=+\-@]/.test(t)?`"'${t.replace(/"/g,'""')}"`:`"${t.replace(/"/g,'""')}"`};
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\ufeff'+rows.map(r=>r.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),4000)}
// íconos de la barra flotante (trazo, 24×24)
const ICO={club:'<path d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z"/><path d="M9 10.5h6M9 13.5h6"/>',ventas:'<path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/>',enlaces:'<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',tablero:'<rect x="3" y="3" width="7.5" height="9" rx="2"/><rect x="13.5" y="3" width="7.5" height="5.5" rx="2"/><rect x="13.5" y="11.5" width="7.5" height="9.5" rx="2"/><rect x="3" y="15" width="7.5" height="6" rx="2"/>',
 vuelos:'<path d="M10.2 20.6 12 14l-4.8.2-1.7 2.2H3.8l1-3.7-1-3.7h1.7l1.7 2.2 4.8.2-1.8-6.6h2.2l4 6.6h4.2a1.6 1.6 0 0 1 0 3.2h-4.2l-4 6.6z"/>',
 temporadas:'<path d="m12 3 2.6 5.5 6 .8-4.4 4.1 1.1 5.9L12 16.5l-5.3 2.8 1.1-5.9L3.4 9.3l6-.8z"/>',
 reservas:'<path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2.5a2.5 2.5 0 0 0 0 5V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2.5a2.5 2.5 0 0 0 0-5z"/><path d="M14 5v14" stroke-dasharray="2 2.4"/>',
 agencias:'<path d="M4 21V6.5L12 3l8 3.5V21"/><path d="M9 21v-5h6v5M8 9h1.5M14.5 9H16M8 12.5h1.5M14.5 12.5H16"/>',
 embajadores:'<path d="M4 10v4h3l6 4.5V5.5L7 10z"/><path d="M16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11"/>',
 pases:'<rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10.5h18M7 15h4"/>',
 actividad:'<path d="M3 12h4l2.5-6 5 12 2.5-6h4"/>',
 finanzas:'<path d="M4 20V4M4 20h16"/><path d="m7.5 15 3.5-4 3 2.5 5-6.5"/><path d="M15.5 7H19v3.5"/>',
 material:'<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
 soporte:'<path d="M4 5h16v11H8l-4 4z"/><path d="M8 9.5h8M8 12.5h5"/>',
 inicio:'<path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5H15v-6h-6v6H5.5A1.5 1.5 0 0 1 4 19z"/>',
 nueva:'<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
 cuenta:'<path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v4"/><rect x="4" y="7.5" width="16" height="12" rx="2.5"/><path d="M16 13.5h.5"/>'};
let RAIL_PREV=null;
function shell(tabs,cur,body){
  if(cur!=='soporte'&&typeof supStop==='function')supStop();
  const ci=Math.max(0,tabs.findIndex(([k])=>k===cur)), from=RAIL_PREV==null?ci:RAIL_PREV;
  app.innerHTML=`<header class="top"><div class="top-in"><a class="brand" href="/" aria-label="Beemo Air, portal de agencias"><svg class="wm" role="img" aria-label="Beemo Air"><use href="#wm"/></svg><span>${me.ambassador?'Embajadores':'Agencias'}</span></a>
   <div class="who">${SCENE_SW()}${THEME_SW()}<span class="who-u"><b>${esc(me.ambassador?me.ambassador.name:me.agency?me.agency.name:'Beemo Air')}${me.agency&&me.agency.country?' · '+esc(me.agency.country):''}</b>${me.ambassador?'Embajador · '+esc(me.ambassador.code):esc(me.name||me.email)}</span><button class="btn ghost sm" id="out">Salir</button></div></div></header>
   <nav class="rail" aria-label="Secciones" style="--n:${tabs.length};--i:${from}"><span class="rail-ind" aria-hidden="true"></span>${tabs.map(([k,t])=>`<a href="#${k}" ${k===cur?'aria-current="page"':''}><svg viewBox="0 0 24 24" aria-hidden="true">${ICO[k]||ICO.tablero}</svg><span class="rail-l">${t}</span></a>`).join('')}</nav>
   ${me.readonly&&!me.viewer?`<div class="viewbar ro" role="status"><span><b>Acceso de solo lectura${me.expires?` hasta el ${fmtD(me.expires.slice(0,10),{day:'numeric',month:'long'})}`:''}.</b> Puedes recorrer todo el portal; los botones que hacen cambios no tendrán efecto.</span></div>`:''}
   ${me.viewer&&me.ambassador?`<div class="viewbar" role="status"><span><b>Vista de embajador:</b> estás viendo el portal como <b>${esc(me.ambassador.name)}</b> (${esc(me.ambassador.code)}). Así ve sus ventas y sus enlaces.</span><button class="btn sm" id="vbX">Cerrar vista</button></div>`:me.viewer?`<div class="viewbar" role="status"><span><b>Vista de agencia:</b> estás viendo el portal como <b>${esc(me.agency.name.replace(/\.$/,""))}</b>${me.agency.active?'':' (agencia inactiva)'}. Lo que reserves aquí queda a nombre de esta agencia.</span><button class="btn sm" id="vbX">Cerrar vista</button></div>`:''}
   <main class="wrap main has-rail" id="main">${body}</main>${BG}`;
  document.title=`${(tabs[ci]||[])[1]||'Portal'} · ${me.ambassador?'Embajadores':'Portal de agencias'} · Beemo Air`;
  if(RAIL_PREV!=null&&from!==ci) scrollTo(0,0);   // al cambiar de pestaña se empieza arriba
  RAIL_PREV=ci; setTimeout(supBadge,0);
  if(innerWidth<=900){const ac=$('.rail [aria-current]');if(ac){const r=$('.rail');r.scrollLeft=ac.offsetLeft-r.clientWidth/2+ac.offsetWidth/2}}
  if(from!==ci) requestAnimationFrame(()=>requestAnimationFrame(()=>{const r=$('.rail');if(r)r.style.setProperty('--i',ci)}));
  bindTheme();
  const vb=$('#vbX'); if(vb) vb.onclick=async()=>{try{await api('/auth/logout',{body:{}})}catch(e){} token='';sessionStorage.removeItem('beemo-agt');me=null;window.close();location.hash='';boot()};
  $('#out').onclick=async()=>{try{await api('/auth/logout',{body:{}})}catch(e){} token='';sessionStorage.removeItem('beemo-agt');me=null;RAIL_PREV=null;location.hash='';boot()};
}

/* ---------- login / setup / password ---------- */
async function viewLogin(){
  let setup=false; try{setup=(await api('/admin/setup')).needed}catch(e){}
  app.innerHTML=`${BG}<div class="login"><div class="login-top">${SCENE_SW()}${THEME_SW()}</div><div class="login-card">
   <svg class="wm big" role="img" aria-label="Beemo Air"><use href="#wm"/></svg>
   <h1>Portal de agencias</h1><p class="muted">Reserva y emite vuelos de Beemo Air para tus clientes, con el mismo inventario de beemoair.com.</p>
   ${setup?`<form id="setupF" class="stack"><h2>Configura la cuenta de administrador</h2><label>Código de configuración<input name="code" autocomplete="off" required></label><label>Nombre<input name="name" autocomplete="name"></label><label>Correo<input name="email" type="email" autocomplete="email" required></label><label>Contraseña (mínimo 10 caracteres)<input name="password" type="password" autocomplete="new-password" required></label><p class="note" hidden></p><button class="btn lime">Crear administrador</button></form><hr>`:''}
   <form id="loginF" class="stack"><label>Correo o usuario<input name="email" type="text" inputmode="email" autocapitalize="none" autocorrect="off" spellcheck="false" autocomplete="username" required></label><label>Contraseña<input name="password" type="password" autocomplete="current-password" required></label><p class="note" hidden></p><button class="btn lime">Entrar</button></form>
   <p class="fine">¿Tu agencia aún no tiene acceso? Escríbenos a <a href="mailto:management@beemoair.com">management@beemoair.com</a>.</p></div></div>`;
  bindTheme(); const lf=$('#loginF');
  lf.onsubmit=async e=>{e.preventDefault();const n=$('.note',lf);note(n,'');const d=Object.fromEntries(new FormData(lf));
    try{const r=await api('/auth/login',{body:d});token=r.token;sessionStorage.setItem('beemo-agt',token);me=r.user;boot()}catch(err){note(n,err.message,'err')}};
  const sf=$('#setupF'); if(sf) sf.onsubmit=async e=>{e.preventDefault();const n=$('.note',sf);const d=Object.fromEntries(new FormData(sf));
    try{await api('/admin/setup',{body:d});note(n,'Listo. Ya puedes entrar con ese correo y contraseña.','ok');sf.querySelector('button').disabled=true;lf.email.value=d.email}catch(err){note(n,err.message,'err')}};
}
function viewPassword(){
  app.innerHTML=`${BG}<div class="login"><div class="login-top">${THEME_SW()}</div><div class="login-card"><svg class="wm big" role="img" aria-label="Beemo Air"><use href="#wm"/></svg><h1>Crea tu contraseña</h1><p class="muted">Entraste con una contraseña temporal. Elige una nueva de al menos 10 caracteres.</p>
   <form id="pwF" class="stack"><label>Nueva contraseña<input name="password" type="password" autocomplete="new-password" required minlength="10"></label><label>Repítela<input name="again" type="password" autocomplete="new-password" required></label><p class="note" hidden></p><button class="btn lime">Guardar y continuar</button></form></div></div>`;
  bindTheme(); const f=$('#pwF');f.onsubmit=async e=>{e.preventDefault();const n=$('.note',f);if(f.password.value!==f.again.value)return note(n,'Las contraseñas no coinciden.','err');
    try{await api('/me/password',{body:{password:f.password.value}});me.must_change=false;boot()}catch(err){note(n,err.message,'err')}};
}

/* ---------- seat map ---------- */
function seatMap({fare,taken,mine,activePax,readOnly,names,status}){
  let h=`<div class="cabin" role="grid" aria-label="Mapa de asientos"><div class="row cols"><span>A</span><span>B</span><span>C</span><span></span><span>D</span><span>E</span><span>F</span></div>`;
  for(let r=1;r<=ROWS;r++){const z=zoneOf(r);h+=`<div class="row${r===BIZ+1?' gap':''}${EXIT.includes(r)?' exit':''}" role="row">`;
    COLS.forEach((c,ci)=>{if(ci===3)h+=`<span class="rn">${r}</span>`;if(!isSeat(r,c)){h+='<span></span>';return}
      const id=r+c, own=mine?mine.indexOf(id):-1, tk=taken.has(id)&&own<0, wrong=fare&&(fare==='bc'?r>BIZ:r<=BIZ);
      const cls=['seat',readOnly?'ro':'',r<=BIZ?'biz':'z'+z,own===activePax?'mine':own>=0?'other':'',wrong&&own<0?'blocked':''].join(' ');
      const lbl=`Asiento ${id}${tk?(status&&status[id]==='pending'?', apartada sin pago':status?', emitida':', ocupado'):wrong?', otra cabina':own>=0?`, pasajero ${own+1}`:', libre'}${fare&&!tk&&!wrong?' · '+(seatPrice(fare,id)?'US$'+seatPrice(fare,id):'sin costo'):''}${names&&names[id]?' · '+names[id]:''}`;
      h+=`<button type="button" class="${cls}${tk&&readOnly?(status&&status[id]==='pending'?' held':' sold'):''}" data-seat="${id}" ${tk&&!readOnly||readOnly?'':''} ${readOnly?'tabindex="-1" aria-disabled="true"':(tk||wrong?'disabled':'')} title="${esc(lbl)}" aria-label="${esc(lbl)}">${own>=0?own+1:''}</button>`});
    h+='</div>'}
  return h+'</div>';
}

/* ---------- controles de vidrio: lista desplegable y calendario propios (reemplazan los nativos del navegador) ---------- */
const G_CHEV='<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const G_CAL='<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 10h17M8 3v4M16 3v4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
let GP=null;
function gpClose(focus){if(!GP)return;const o=GP;GP=null;o.pop.hidden=true;o.pop.remove();o.btn.setAttribute('aria-expanded','false');if(focus&&o.btn.isConnected)o.btn.focus()}
function gpPlace(o){const r=o.btn.getBoundingClientRect(),p=o.pop;p.style.minWidth=r.width+'px';p.style.left='0px';p.style.top='0px';
  const w=p.offsetWidth,h=p.offsetHeight,below=innerHeight-r.bottom,up=below<h+16&&r.top>h+16;
  p.style.left=Math.max(8,Math.min(innerWidth-w-8,r.left))+scrollX+'px';p.style.top=(up?r.top-h-8:r.bottom+8)+scrollY+'px';p.classList.toggle('up',up)}
function gpOpen(o){if(GP===o)return gpClose();gpClose();if(o.btn.disabled)return;o.pop.style.left='0px';o.pop.style.top='0px';if(!o.pop.isConnected)document.body.appendChild(o.pop);GP=o;o.pop.hidden=false;o.btn.setAttribute('aria-expanded','true');o.onopen&&o.onopen();gpPlace(o);o.after&&o.after()}
document.addEventListener('pointerdown',e=>{if(GP&&!GP.btn.contains(e.target)&&!GP.pop.contains(e.target))gpClose()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&GP){e.preventDefault();gpClose(true)}});
addEventListener('resize',()=>gpClose());addEventListener('hashchange',()=>gpClose());
const gLabel=el=>{const l=el.closest('label');let t=el.getAttribute('aria-label')||'';if(!t&&l){t=[...l.childNodes].filter(n=>n.nodeType===3||n.nodeName==='SPAN').map(n=>n.textContent).join(' ').trim()}return t};
// engancha los cambios hechos por código (el.value = x) para que el botón no quede desactualizado
function gHook(el,proto,props,fn){props.forEach(p=>{const d=Object.getOwnPropertyDescriptor(proto,p);if(!d||!d.set)return;Object.defineProperty(el,p,{configurable:true,get(){return d.get.call(el)},set(v){d.set.call(el,v);fn()}})})}
function gSelect(sel){
  if(sel.dataset.g||sel.multiple||sel.size>1)return;sel.dataset.g=1;sel.classList.add('g-nat');sel.tabIndex=-1;
  const btn=document.createElement('button'),pop=document.createElement('ul'),o={btn,pop};let ta='',taT=0;
  btn.type='button';btn.className='g-btn';btn.setAttribute('aria-haspopup','listbox');btn.setAttribute('aria-expanded','false');
  pop.className='gpop g-list';pop.setAttribute('role','listbox');pop.hidden=true;sel.after(btn);
  const draw=()=>{const cur=sel.selectedOptions[0],txt=cur?cur.textContent:'',lab=gLabel(sel);btn.innerHTML=`<span>${esc(txt)}</span>${G_CHEV}`;btn.disabled=sel.disabled;btn.hidden=sel.hidden;if(lab)btn.setAttribute('aria-label',`${lab}: ${txt}`);
    if(GP===o)list()};
  const list=()=>{pop.innerHTML=[...sel.options].map((op,i)=>`<li role="option" tabindex="-1" data-i="${i}" aria-selected="${op.selected}" ${op.disabled?'aria-disabled="true"':''}>${esc(op.textContent)||'&nbsp;'}</li>`).join('')};
  const pick=i=>{if(sel.options[i]&&sel.options[i].disabled)return;const ch=sel.selectedIndex!==i;sel.selectedIndex=i;if(ch){sel.dispatchEvent(new Event('input',{bubbles:true}));sel.dispatchEvent(new Event('change',{bubbles:true}))}gpClose(true)};
  o.onopen=list;o.after=()=>{const c=pop.querySelector('[aria-selected=true]')||pop.firstChild;if(c){pop.scrollTop=Math.max(0,c.offsetTop-pop.clientHeight/2+c.offsetHeight/2);c.focus({preventScroll:true})}};
  btn.onclick=()=>gpOpen(o);
  btn.onkeydown=e=>{if((e.key==='ArrowDown'||e.key==='ArrowUp')&&GP!==o){e.preventDefault();gpOpen(o)}};
  pop.onclick=e=>{const li=e.target.closest('li');if(li)pick(+li.dataset.i)};
  pop.onkeydown=e=>{const li=e.target.closest('li');if(!li)return;const go=n=>{e.preventDefault();if(n){n.focus({preventScroll:true});const t=n.offsetTop,b=t+n.offsetHeight;if(t<pop.scrollTop)pop.scrollTop=t-6;else if(b>pop.scrollTop+pop.clientHeight)pop.scrollTop=b-pop.clientHeight+6}};
    if(e.key==='ArrowDown')go(li.nextElementSibling);else if(e.key==='ArrowUp')go(li.previousElementSibling);else if(e.key==='Home')go(pop.firstChild);else if(e.key==='End')go(pop.lastChild);
    else if(e.key==='Enter'||e.key===' '){e.preventDefault();pick(+li.dataset.i)}else if(e.key==='Tab')gpClose()
    else if(e.key.length===1&&!e.ctrlKey&&!e.metaKey){clearTimeout(taT);ta+=e.key.toLowerCase();taT=setTimeout(()=>ta='',700);const nz=t=>t.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''),m=[...pop.children].find(x=>nz(x.textContent).startsWith(nz(ta)));m&&go(m)}};
  sel.addEventListener('change',draw);gHook(sel,HTMLSelectElement.prototype,['value','selectedIndex'],draw);
  new MutationObserver(draw).observe(sel,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','hidden','selected']});draw();
}
// calendario: marks(ym) puede devolver las fechas con vuelo para señalarlas; respeta min y max del campo
function gDate(inp,marks){
  if(inp.dataset.g)return;inp.dataset.g=1;inp.classList.add('g-nat');inp.tabIndex=-1;
  const btn=document.createElement('button'),pop=document.createElement('div'),o={btn,pop};let ym='',seq=0;
  btn.type='button';btn.className='g-btn';btn.setAttribute('aria-haspopup','dialog');btn.setAttribute('aria-expanded','false');
  pop.className='gpop g-cal';pop.setAttribute('role','dialog');pop.setAttribute('aria-label','Elegir fecha');pop.tabIndex=-1;pop.hidden=true;inp.after(btn);
  const iso=d=>d.toLocaleDateString('en-CA'),today=()=>iso(new Date()),off=k=>!!(inp.min&&k<inp.min||inp.max&&k>inp.max);
  const label=()=>{const lab=gLabel(inp),txt=inp.value?fmtD(inp.value,{weekday:'short',day:'numeric',month:'short',year:'numeric'}):'Elegir fecha';btn.innerHTML=`<span class="${inp.value?'':'g-ph'}">${txt}</span>${G_CAL}`;btn.disabled=inp.disabled;btn.hidden=inp.hidden;if(lab)btn.setAttribute('aria-label',`${lab}: ${txt}`)};
  const set=v=>{const ch=inp.value!==v;inp.value=v;if(ch){inp.dispatchEvent(new Event('input',{bubbles:true}));inp.dispatchEvent(new Event('change',{bubbles:true}))}gpClose(true)};
  const draw=async()=>{const [Y,M]=ym.split('-').map(Number),first=new Date(Y,M-1,1),n=new Date(Y,M,0).getDate(),lead=(first.getDay()+6)%7,t=today(),my=++seq;
    const name=first.toLocaleDateString('es',{month:'long',year:'numeric'}),prev=iso(new Date(Y,M-2,1)).slice(0,7),next=iso(new Date(Y,M,1)).slice(0,7);
    const cells=fl=>{let h='';for(let i=0;i<lead;i++)h+='<span></span>';for(let d=1;d<=n;d++){const k=`${ym}-${String(d).padStart(2,'0')}`,f=fl&&fl.has(k);
      h+=`<button type="button" data-d="${k}" class="${k===inp.value?'on':''}${k===t?' today':''}${f?' gf':''}" ${off(k)?'disabled':''} aria-label="${fmtD(k,{weekday:'long',day:'numeric',month:'long'})}${f?', hay vuelo':''}" ${k===inp.value?'aria-current="date"':''}>${d}</button>`}return h};
    const paint=fl=>{pop.innerHTML=`<div class="g-ch"><button type="button" data-m="${prev}" ${inp.min&&prev<inp.min.slice(0,7)?'disabled':''} aria-label="Mes anterior">‹</button><b>${name[0].toUpperCase()+name.slice(1)}</b><button type="button" data-m="${next}" ${inp.max&&next>inp.max.slice(0,7)?'disabled':''} aria-label="Mes siguiente">›</button></div>
      <div class="g-cw"><span>lu</span><span>ma</span><span>mi</span><span>ju</span><span>vi</span><span>sá</span><span>do</span></div><div class="g-cd">${cells(fl)}</div>
      <div class="g-cf">${marks?'<p class="g-cl"><i></i>Días con vuelo en esta ruta</p>':'<span></span>'}<span class="g-ca">${off(t)?'':`<button type="button" data-set="${t}">Hoy</button>`}${inp.required||!inp.value?'':'<button type="button" data-set="">Borrar</button>'}</span></div>`;if(GP===o)gpPlace(o)};
    paint(null);if(marks){let fl=null;try{fl=await marks(ym)}catch(e){}if(my===seq&&fl){const f=document.activeElement&&document.activeElement.dataset?document.activeElement.dataset.d:null;paint(fl);const b=f&&pop.querySelector(`[data-d="${f}"]`);b&&b.focus({preventScroll:true})}}};
  o.onopen=()=>{ym=(inp.value||(inp.min&&inp.min>today()?inp.min:today())).slice(0,7);draw()};o.after=()=>{const b=pop.querySelector('.on:not(:disabled)')||pop.querySelector('.g-cd button:not(:disabled)');b&&b.focus({preventScroll:true})};
  btn.onclick=()=>gpOpen(o);
  pop.onclick=e=>{const m=e.target.closest('[data-m]'),d=e.target.closest('[data-d]'),s=e.target.closest('[data-set]');
    if(m&&!m.disabled){ym=m.dataset.m;draw();pop.focus({preventScroll:true})}else if(d&&!d.disabled)set(d.dataset.d);else if(s)set(s.dataset.set)};
  pop.onkeydown=e=>{const b=e.target.closest('[data-d]');if(!b)return;const step={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7}[e.key];if(!step)return;e.preventDefault();
    const all=[...pop.querySelectorAll('.g-cd button')],t=all[all.indexOf(b)+step];if(t&&!t.disabled)t.focus()};
  inp.addEventListener('change',label);gHook(inp,HTMLInputElement.prototype,['value'],label);
  new MutationObserver(label).observe(inp,{attributes:true,attributeFilter:['disabled','hidden']});label();
}
// convierte todas las listas y fechas nativas que aparezcan en el portal
function gScan(){$$('#app select:not([data-g])').forEach(gSelect);$$('#app input[type=date]:not([data-g])').forEach(i=>gDate(i))}

/* ---------- BEE CLUB: consulta para agencias y pestaña del administrador ---------- */
const CLUB_RE=/^BEE[-\s]?\d{6}$/i, clubNo=n=>String(n||'').replace(/^BEE/,'BEE-');
const CLUB_SRC={web:'beemoair.com',agencia:'Agencia',admin:'Beemo Air'};
const pts=n=>Math.round(n||0).toLocaleString('es-CO');
function clubCard(m){return `<article class="clubm"><header><span class="clubn">${clubNo(m.number)}</span><b>${esc(m.name)}</b><span class="st ${m.plan==='pro'?'confirmed':'pending'}">${m.plan==='pro'?'Pro':'Free'}</span><span class="st confirmed">${esc(m.level)}</span></header>
  <ul class="fx-stats two"><li>${fxCount(m.points)}<span>Puntos Miel disponibles</span></li><li>${fxCount(m.pending_points)}<span>por acreditar${m.pending_flights?` en ${m.pending_flights} ${m.pending_flights===1?'trayecto':'trayectos'} por volar`:''}</span></li><li>${fxCount(m.flights_12m)}<span>trayectos volados en 12 meses</span></li><li>${m.next?fxCount(m.next.missing):'<b class="clubv">—</b>'}<span>${m.next?`${m.next.missing===1?'trayecto':'trayectos'} para ${esc(m.next.name)}`:'nivel más alto'}</span></li></ul>
  <p class="fine">Socio desde ${fmtD(m.since,{day:'numeric',month:'long',year:'numeric'})}. ${m.plan==='pro'?`BEE CLUB Pro hasta ${fmtD(m.pro_until,{day:'numeric',month:'long',year:'numeric'})}: `:'Plan Free: '}suma ${String(m.rate).replace('.',',')} ${m.rate===1?'punto':'puntos'} por dólar de tarifa, después de cada vuelo.</p></article>`}
function clubRewards(R,bal){return `<h3 class="fx-sub">Tabla de canje</h3><div class="tw"><table class="tbl"><thead><tr><th>Recompensa</th><th>Puntos</th>${bal==null?'':'<th>Le alcanza</th>'}</tr></thead><tbody>${R.rewards.map(w=>`<tr><td>${esc(w.name)}</td><td><b>${pts(w.points)}</b></td>${bal==null?'':`<td>${bal>=w.points?'Sí':`Faltan ${pts(w.points-bal)}`}</td>`}</tr>`).join('')}</tbody></table></div><p class="fine">El canje lo aplica Beemo Air: escribe a soporte con el número de socio y la reserva, hasta 72 horas antes del vuelo. Los bonos de tarifa valen desde Basic, uno por tiquete; las tasas siempre se pagan en dinero. Los puntos vencen a los ${R.expiry_months} meses sin actividad. BEE CLUB Pro: ${money(R.pro_price)} al año y ${R.rates.pro} puntos por dólar; Free: ${String(R.rates.free).replace('.',',')}.</p>`}
async function viewClubAgent(){
  shell(agentTabs,'club',`<section class="card"><h1>BEE CLUB</h1><p class="muted">Consulta los Puntos Miel de un cliente con su número de socio o su teléfono.</p>
    <form id="clq" class="srch"><label>Número de socio o teléfono<input name="q" placeholder="BEE-000000 o +57 300 000 0000" autocomplete="off" required></label><button class="btn lime">Consultar</button></form><p class="note" id="clqN" hidden></p><div id="clr"></div></section>
   <section class="card"><h2>Inscribir a un cliente</h2><p class="muted">Es gratis. El cliente recibe su número de socio y empieza a sumar desde su primer vuelo.</p>
    <form id="clj" class="ag-form"><label>Nombre<input name="first" autocomplete="off" required></label><label>Apellido<input name="last" autocomplete="off" required></label><label>Correo<input name="email" type="email" autocomplete="off" required></label><label>Teléfono con indicativo<input name="phone" type="tel" autocomplete="off" placeholder="+57 300 000 0000" required></label><label>Ciudad<input name="city" autocomplete="off"></label>
     <label class="chk wide2"><input type="checkbox" name="consent" required> El cliente acepta los términos del club y recibir comunicaciones de Beemo Air.</label><button class="btn lime">Inscribir</button><p class="note wide2" hidden></p></form></section>`);
  const f=$('#clq'),n=$('#clqN'),box=$('#clr');
  f.onsubmit=async e=>{e.preventDefault();note(n,'');box.innerHTML='';
    try{const r=await api('/agency/club?q='+encodeURIComponent(f.q.value.trim()));
      box.innerHTML=r.members.length?`<div class="clubg">${r.members.map(clubCard).join('')}</div>${clubRewards(r.rules,r.members.length===1?r.members[0].points:null)}`:'<p class="clube">No encontramos un socio con ese dato. Revisa el número o el teléfono, o inscríbelo abajo.</p>'}
    catch(err){note(n,err.message,'err')}};
  const j=$('#clj'); j.onsubmit=async e=>{e.preventDefault();const jn=$('.note',j),d=Object.fromEntries(new FormData(j));d.consent=!!j.consent.checked;
    try{const r=await api('/agency/club',{body:d});j.reset();note(jn,`Listo: el número de socio es ${clubNo(r.number)}. Anótalo en la reserva del cliente para que sume puntos.`,'ok')}catch(err){note(jn,err.message,'err')}};
}
let CLQ='',CLO=null;
async function viewClubAdmin(){
  shell(adminTabs,'club',`<section class="card"><div class="hd"><h1>BEE CLUB</h1><button class="btn ghost sm" id="clx">Descargar socios (CSV)</button></div><div id="clm"><p class="muted">Cargando…</p></div></section>
   <section class="card"><div class="hd"><h2>Socios</h2><form id="clf" class="clfind"><input name="q" value="${esc(CLQ)}" placeholder="Nombre, correo, teléfono o número" aria-label="Buscar socio" autocomplete="off"><button class="btn ghost sm">Buscar</button></form></div><div id="cll"></div></section>
   <div id="cld"></div>
   <div class="fin2"><section class="card"><h2>De dónde llegan</h2><div id="cls"></div></section>
   <section class="card"><h2>Inscribir un socio</h2><form id="cln" class="ag-form"><label>Nombre<input name="first" required></label><label>Apellido<input name="last" required></label><label>Correo<input name="email" type="email" required></label><label>Teléfono con indicativo<input name="phone" type="tel" required></label><label>Ciudad<input name="city"></label><label class="chk wide2"><input type="checkbox" name="consent" required> Aceptó los términos y las comunicaciones.</label><button class="btn lime">Inscribir</button><p class="note wide2" hidden></p></form></section></div>`);
  $('#clf').onsubmit=e=>{e.preventDefault();CLQ=e.target.q.value.trim();drawClub()};
  const nf=$('#cln'); nf.onsubmit=async e=>{e.preventDefault();const n=$('.note',nf),d=Object.fromEntries(new FormData(nf));d.consent=!!nf.consent.checked;
    try{const r=await api('/admin/club',{body:d});nf.reset();note(n,`Socio creado: ${clubNo(r.number)}.`,'ok');drawClub()}catch(err){note(n,err.message,'err')}};
  await drawClub();
}
async function drawClub(){
  let d; try{d=await api('/admin/club'+(CLQ?'?q='+encodeURIComponent(CLQ):''))}catch(e){const b=$('#clm');if(b)b.innerHTML=`<p class="note err" style="display:block">${esc(e.message)}</p>`;return}
  CLR=d.rules;const m=d.metrics,box=$('#clm'); if(!box) return; const mxw=Math.max(1,...d.weeks.map(w=>w.n));
  box.innerHTML=`<div class="fx-grid ss clubtop"><div class="fx-cell">${fxGauge({p:m.active_rate,val:`${fxCount(m.active_rate*100,'pct')}`,label:'de los socios ya voló',sub:`${pts(m.flown)} de ${pts(m.members)} socios`})}</div>
    <div class="fx-cell">${fxDonut(d.rules.levels.map((l,i)=>({v:d.levels[l.name]||0,label:l.name,cls:'c'+(i+1)})),fxCount(m.members),'socios')}</div>
    <div class="fx-cell fx-wide"><h3 class="fx-sub">Inscripciones por semana</h3>${fxPills(d.weeks.map((w,i)=>({label:fmtD(w.to,{day:'numeric',month:'short'}),p:w.n/mxw,txt:w.n,on:i===d.weeks.length-1,aria:`Semana al ${w.to}: ${w.n} socios`,tip:`<b>${fmtD(w.from,{day:'numeric',month:'short'})} – ${fmtD(w.to,{day:'numeric',month:'short'})}</b><br>${w.n} ${w.n===1?'socio nuevo':'socios nuevos'}`})),{H:120})}</div></div>
   <ul class="fx-stats clubk"><li>${fxCount(m.new_7d)}<span>nuevos en 7 días</span></li><li>${fxCount(m.new_30d)}<span>nuevos en 30 días</span></li><li>${fxCount(m.pro)}<span>socios Pro activos</span></li><li>${fxCount(m.pro_income,'money')}<span>cobrado por membresías Pro</span></li><li>${fxCount(m.member_legs)}<span>trayectos volados por socios</span></li><li>${fxCount(m.near_level)}<span>a un vuelo de subir de nivel</span></li>
    <li>${fxCount(m.points_balance)}<span>Puntos Miel vigentes</span></li><li>${fxCount(m.pending_points)}<span>puntos por acreditar (vuelos por salir)</span></li><li>${fxCount(m.liability_value,'money')}<span>valor de los puntos vigentes</span></li><li>${fxCount(m.liability_cost,'money')}<span>costo estimado de redimirlos</span></li></ul>
   <p class="fine">Los puntos se acreditan ${d.rules.credit_hours} horas después de la salida de cada vuelo emitido: Free suma ${String(d.rules.rates.free).replace('.',',')} puntos y Pro ${d.rules.rates.pro} por dólar de tarifa, sin tasas ni extras; HoneyBee suma 25 % más y GoldenBee 50 %. Pro cuesta ${money(d.rules.pro_price)} al año. Valor de canje de referencia: ${money(d.rules.point_value*100)} por cada 100 puntos.</p>`;
  const ll=$('#cll'); ll.innerHTML=d.members.length?`<div class="tw"><table class="tbl clubt"><thead><tr><th>Socio</th><th>Contacto</th><th>Plan</th><th>Nivel</th><th>Puntos</th><th>Por acreditar</th><th>Vuelos 12 m</th><th>Canal</th><th>Desde</th></tr></thead><tbody>${d.members.map(v=>`<tr data-cm="${v.id}" tabindex="0" class="${CLO===v.id?'on':''}${v.active?'':' off'}"><td><b>${esc(v.name)}</b><small>${clubNo(v.number)}</small></td><td>${esc(v.email)}<small>${esc(v.phone)}${v.city?' · '+esc(v.city):''}</small></td><td>${v.plan==='pro'?'<span class="st confirmed">Pro</span>':'Free'}</td><td><span class="st ${v.level==='BumbleBee'?'pending':'confirmed'}">${v.level}</span></td><td><b>${pts(v.points)}</b></td><td>${pts(v.pending_points)}</td><td>${v.flights_12m}</td><td>${esc(v.agency||CLUB_SRC[v.source]||v.source)}</td><td>${fmtD(v.since,{day:'numeric',month:'short',year:'numeric'})}</td></tr>`).join('')}</tbody></table></div>
    <p class="fine">${d.members.length} de ${d.total} ${d.total===1?'socio':'socios'}${CLQ?` con «${esc(CLQ)}»`:''}. Toca una fila para ver sus movimientos o ajustar puntos.</p>`
   :`<p class="muted">${CLQ?'Ningún socio coincide con esa búsqueda.':'Todavía no hay socios inscritos. Aparecerán aquí cuando alguien se una desde beemoair.com o una agencia lo inscriba.'}</p>`;
  $$('[data-cm]',ll).forEach(tr=>{const go=()=>{CLO=+tr.dataset.cm;$$('[data-cm]',ll).forEach(x=>x.classList.toggle('on',x===tr));drawClubMember()};tr.onclick=go;tr.onkeydown=e=>{if(e.key==='Enter')go()}});
  const src=Object.entries(d.sources).map(([k,v])=>({n:CLUB_SRC[k]||k,v})).sort((a,b)=>b.v-a.v), cities=Object.entries(d.cities).map(([k,v])=>({n:k,v})).sort((a,b)=>b.v-a.v).slice(0,6);
  $('#cls').innerHTML=d.total?`<h3 class="fx-sub">Por canal</h3>${fxBars(src,'int')}<h3 class="fx-sub">Por ciudad</h3>${fxBars(cities,'int')}
    ${d.agencies.length?`<h3 class="fx-sub">Por agencia</h3><div class="tw"><table class="tbl"><thead><tr><th>Agencia</th><th>Socios inscritos</th><th>Consultas</th><th>Con resultado</th></tr></thead><tbody>${d.agencies.map(a=>`<tr><td>${esc(a.agency)}</td><td>${a.members}</td><td>${a.n}</td><td>${a.hits}</td></tr>`).join('')}</tbody></table></div>`:''}
    <p class="fine">${pts(m.consent)} de ${pts(m.members)} socios autorizaron comunicaciones.</p>`:'<p class="muted">Sin datos todavía.</p>';
  $('#clx').onclick=()=>{const rows=[['Numero','Nombre','Correo','Telefono','Ciudad','Plan','Nivel','Puntos','Por acreditar','Vuelos 12 meses','Canal','Agencia','Desde','Ultimo vuelo','Comunicaciones']].concat(d.members.map(v=>[clubNo(v.number),v.name,v.email,v.phone,v.city||'',v.plan==='pro'?'Pro hasta '+v.pro_until:'Free',v.level,v.points,v.pending_points,v.flights_12m,CLUB_SRC[v.source]||v.source,v.agency||'',v.since,v.last_flight||'',v.consent?'si':'no']));
    const csv='﻿'+rows.map(r=>r.map(c=>{const t=String(c??'');return /^[=+\-@]/.test(t)?`"'${t.replace(/"/g,'""')}"`:`"${t.replace(/"/g,'""')}"`}).join(',')).join('\r\n'), a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.download=`bee-club-socios-${new Date().toLocaleDateString('en-CA')}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000)};
  if(CLO) drawClubMember();
}
const CLUB_K={vuelo:'Vuelo',ajuste:'Ajuste',canje:'Canje',bono:'Bono',pro:'Membresía Pro'};let CLR=null;
async function drawClubMember(){
  const box=$('#cld'); if(!box||!CLO) return; let r; try{r=await api('/admin/club/'+CLO)}catch(e){box.innerHTML='';return}
  const v=r.member;
  box.innerHTML=`<section class="card clubd"><div class="hd"><h2>${esc(v.name)} <small class="muted">${clubNo(v.number)}</small></h2><button class="btn ghost sm" id="cldX">Cerrar</button></div>
    <div class="fin2"><div>${clubCard(v)}<p class="fine">${esc(v.email)} · ${esc(v.phone)}${v.city?' · '+esc(v.city):''}</p></div>
    <form id="cla" class="ag-form"><h3 class="wide2">Ajustar puntos</h3><label>Puntos (negativo para restar)<input name="points" inputmode="numeric" placeholder="500" required></label><label class="wide2">Motivo<input name="note" placeholder="Ej.: puntos de un vuelo que no se registró" required></label><button class="btn lime">Aplicar ajuste</button><p class="note wide2" hidden></p></form></div>
    <div class="fin2 clubops"><form id="clrd" class="ag-form"><h3 class="wide2">Canjear puntos</h3><label>Recompensa<select name="reward" required><option value="">${v.points<CLR.rewards[0].points?'Aún no le alcanza':'Elige la recompensa'}</option>${CLR.rewards.map(w=>`<option value="${w.id}"${v.points<w.points?' disabled':''}>${esc(w.name)} · ${pts(w.points)} puntos</option>`).join('')}</select></label><label>Reserva donde se aplica<input name="ref" placeholder="Código de reserva" required></label><button class="btn lime">Canjear</button><p class="note wide2" hidden></p></form>
    <form id="clpro" class="ag-form"><h3 class="wide2">BEE CLUB Pro</h3><p class="muted wide2">${v.plan==='pro'?`Activo hasta ${fmtD(v.pro_until,{day:'numeric',month:'long',year:'numeric'})}. Renovar suma 12 meses.`:'Plan Free. Activar Pro da 12 meses con más puntos por dólar.'}</p><label>Valor cobrado (US$)<input name="paid" inputmode="decimal" value="${CLR.pro_price}" required></label><button class="btn lime">${v.plan==='pro'?'Renovar 12 meses':'Activar Pro 12 meses'}</button><p class="note wide2" hidden></p></form></div>
    <h3 class="fx-sub">Movimientos</h3>${r.ledger.length?`<div class="tw"><table class="tbl"><thead><tr><th>Fecha</th><th>Tipo</th><th>Detalle</th><th>Reserva</th><th>Puntos</th></tr></thead><tbody>${r.ledger.map(l=>`<tr><td>${fmtDT(l.at)}</td><td>${CLUB_K[l.kind]||l.kind}</td><td>${esc(l.note||'')}${l.flight?` · ${fmtD(l.flight.split('|')[1],{day:'numeric',month:'short',year:'numeric'})}`:''}${l.by?`<small>${esc(l.by)}</small>`:''}</td><td>${esc(l.pnr||'—')}</td><td><b>${l.points>0?'+':''}${pts(l.points)}</b></td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">Aún no tiene movimientos. Los puntos aparecen después de su primer vuelo.</p>'}</section>`;
  $('#cldX').onclick=()=>{CLO=null;box.innerHTML='';$$('[data-cm]').forEach(x=>x.classList.remove('on'))};
  const f=$('#cla'); f.onsubmit=async e=>{e.preventDefault();const n=$('.note',f);if(!confirm(`¿Aplicar un ajuste de ${f.points.value} puntos a ${v.name}?`))return;
    try{await api(`/admin/club/${CLO}/adjust`,{body:{points:f.points.value,note:f.note.value}});drawClub()}catch(err){note(n,err.message,'err')}};
  const rd=$('#clrd'); rd.onsubmit=async e=>{e.preventDefault();const n=$('.note',rd);if(!confirm(`¿Canjear «${rd.reward.selectedOptions[0].textContent}» a ${v.name}? Los puntos se descuentan ahora.`))return;
    try{await api(`/admin/club/${CLO}/redeem`,{body:{reward:rd.reward.value,ref:rd.ref.value}});drawClub()}catch(err){note(n,err.message,'err')}};
  const pf=$('#clpro'); pf.onsubmit=async e=>{e.preventDefault();const n=$('.note',pf);if(!confirm(`¿Activar BEE CLUB Pro por 12 meses a ${v.name}, con US$${pf.paid.value} cobrados?`))return;
    try{await api(`/admin/club/${CLO}/pro`,{body:{paid:pf.paid.value}});drawClub()}catch(err){note(n,err.message,'err')}};
  box.scrollIntoView({behavior:RM?'auto':'smooth',block:'nearest'});
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
  agentAlerts();
  const f=$('#srch');
  f.onsubmit=async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(f));const n=$('#srchN');note(n,'');
    NB.route=d.route;NB.trip=d.trip;NB.pax=+d.pax;NB.from=d.from;
    const [o,dd]=d.route.split('-'), routes=[d.route].concat(d.trip==='rt'?[dd+'-'+o]:[]);
    try{NB.legs=await Promise.all(routes.map(r=>api(`/agency/flights?route=${r}&from=${d.from}&n=10`)));NB.routes=routes;}catch(err){return note(n,err.message,'err')}
    if(NB.legs.some(l=>!l.length)) return note(n,'No hay vuelos para esa ruta desde la fecha elegida.','err');
    NB.sel=routes.map(()=>({date:null,fare:null}));NB.paxd=Array.from({length:NB.pax},(_,i)=>NB.paxd[i]||{first:'',last:'',inf:false});
    NB.seats=routes.map(()=>[]);NB.extras=routes.map(()=>[]);NB.taken=routes.map(()=>new Set());NB.activeLeg=0;NB.activePax=0;NB.done=null;NB.open=[];
    renderNB()};
  if(NB.legs.length) renderNB(); else drawNewIdle();
  if(NB.auto){NB.auto=0;f.requestSubmit()}   // viene de «Reservar en este vuelo» en Inicio
  f.route.onchange=()=>{if(!NB.legs.length){NB.route=f.route.value;drawNewIdle()}};
  f.from.min=new Date().toLocaleDateString('en-CA');$$('select',f).forEach(gSelect);
  const FD={};gDate(f.from,async()=>{const k=f.route.value;FD[k]=FD[k]||api(`/agency/flights?route=${k}&from=${new Date().toISOString().slice(0,10)}&n=40`).then(l=>new Set(l.map(x=>x.date)));return FD[k]});
}
/* ---------- agente: panel de inicio de «Nueva reserva» (antes de buscar) ---------- */
let NI_T=0;
async function drawNewIdle(){
  const box=$('#nb'); if(!box||NB.legs.length) return;
  const route=NB.route, my=++NI_T, today=new Date().toISOString().slice(0,10);
  if(!box.firstChild) box.innerHTML='<section class="card ni-sk" aria-hidden="true"></section>';
  const [fl,st,plan]=await Promise.all([api(`/agency/flights?route=${route}&from=${today}&n=8`).catch(()=>[]),api('/agency/statement').catch(()=>null),api('/agency/plan').catch(()=>null)]);
  if(my!==NI_T||NB.legs.length||!$('#nb')||location.hash.slice(1)!=='nueva') return;
  const pills=fl.length?fxPills(fl.map((f,i)=>{const free=f.avail.eco+f.avail.biz;return {label:fmtD(f.date,{day:'numeric',month:'short'}),p:free/150,txt:free,on:i===0,aria:`${fmtD(f.date,{weekday:'long',day:'numeric',month:'long'})}: ${free} sillas libres`,
    tip:`<b>${fmtD(f.date,{weekday:'long',day:'numeric',month:'long'})}</b><br>${f.no} · ${f.dep}–${f.arr}<br>${free} sillas libres · ${f.avail.biz} en Business<br>Desde ${money(f.prices.light)} · ${esc(f.season||'')}`}}),{H:150}):'<p class="muted">No hay vuelos programados en esta ruta.</p>';
  const cur=new Date().toLocaleDateString('en-CA',{timeZone:'America/New_York'}).slice(0,7), M=st&&(st.months||[]).find(m=>m.month===cur)||{bookings:0,segs:0,sales:0,commission:0};
  const rate=plan?plan.commission+plan.incentive:(me.agency?me.agency.commission+(me.agency.incentive||0):0);
  const gauge=plan&&plan.tiers&&plan.tiers.length?fxGauge({small:1,p:plan.next?plan.segs/plan.next.min:1,val:`${fxCount(plan.segs)}${plan.next?`<i class="fx-of">/ ${plan.next.min}</i>`:''}`,label:'trayectos este mes',sub:plan.next?`Faltan ${plan.next.missing} para ${esc(plan.next.name)} (+${plan.next.incentive} %)`:'Nivel más alto alcanzado'})
    :fxGauge({small:1,p:1,val:`<b>${String(rate).replace('.',',')} %</b>`,label:'tu comisión',sub:'Sobre la tarifa neta de cada boleto'});
  box.innerHTML=`<div class="ni-grid">
   <section class="card ni-fl"><h2>Próximos vuelos <small class="muted">sillas libres</small></h2>${pills}
    <p class="fine">${fl.length?'Toca un vuelo para reservarlo. La barra muestra cuántas de las 150 sillas siguen libres.':''}</p></section>
   <section class="card ni-me"><h2>Tu agencia este mes</h2><div class="fx-grid rs"><div class="fx-cell">${gauge}</div>
    <ul class="fx-stats"><li>${fxCount(M.bookings)}<span>reservas emitidas</span></li><li>${fxCount(M.sales,'usd')}<span>ventas</span></li><li>${fxCount(M.commission,'money')}<span>tu comisión ganada</span></li></ul></div>
    ${st&&st.pending?`<a class="ni-pend" href="#reservas"><b>${st.pending}</b> ${st.pending===1?'reserva pendiente':'reservas pendientes'} de pago</a>`:M.bookings?'':'<p class="fine">Tu primera reserva del mes aparecerá aquí.</p>'}</section></div>`;
  $$('.ni-fl .fx-pill',box).forEach((el,i)=>{el.classList.add('pick');el.onclick=()=>{const f=$('#srch');if(!f||!fl[i])return;f.from.value=fl[i].date;f.from.dispatchEvent(new Event('change',{bubbles:true}));f.requestSubmit()}; el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();el.onclick()}}});
}
// después de elegir tarifa lleva al paso que sigue: el otro trayecto o los pasajeros
function nbNext(){const secs=$$('#nb>section.card'),i=NB.sel.findIndex(x=>!x.fare),el=secs[i<0?NB.routes.length:i];if(!el)return;
  const bar=$('.top'),off=(bar&&getComputedStyle(bar).position!=='static'?bar.offsetHeight:0)+14;   // deja el título debajo de la barra fija
  scrollTo({top:Math.max(0,el.getBoundingClientRect().top+scrollY-off),behavior:RM?'auto':'smooth'})}
function renderNB(){
  const box=$('#nb'); if(!box) return;
  const ready=NB.sel.length&&NB.sel.every(s=>s.date&&s.fare);
  let h=NB.routes.map((r,li)=>{const [o,d]=r.split('-');return `<section class="card"><h2>${li?'Vuelta':'Ida'}: ${AIR[o]} → ${AIR[d]}</h2><div class="flights">`+
    NB.legs[li].filter(f=>!NB.sel[li].fare||NB.sel[li].date===f.date).map((f,fi)=>{const seats=f.avail.eco+f.avail.biz,op=NB.open&&NB.open[li]!==undefined?NB.open[li]===f.date:fi===0,
      from=Math.min(...FARE_KEYS.filter(k=>(k==='bc'?f.avail.biz:f.avail.eco)>=NB.pax).map(k=>f.prices[k]));
      return `<div class="fl ${NB.sel[li].date===f.date?'on':''}${op?' open':''}" data-date="${f.date}"><div class="fl-h"><b>${fmtD(f.date,{weekday:'long',day:'numeric',month:'long'})}</b><span>${f.no} · ${f.dep}–${f.arr}</span><span class="avail ${seats<20?'low':''}">${fxMini(seats/150,'')} ${seats} sillas libres · ${f.avail.biz} en Business</span></div>
      ${NB.sel[li].fare?`<button type="button" class="btn ghost sm chg" data-chgleg="${li}">Cambiar vuelo</button>`:`<button type="button" class="fl-x" data-flx="${li}" aria-expanded="${op}">${isFinite(from)?`<b>Tarifas desde</b><span>${money(from)}</span>`:'<b>Sin sillas para este grupo</b>'}</button>`}<div class="fares f6">${FARE_KEYS.map(k=>{const soldOut=k==='bc'?f.avail.biz<NB.pax:f.avail.eco<NB.pax;return `<button type="button" class="fare" data-leg="${li}" data-date="${f.date}" data-fare="${k}" aria-pressed="${NB.sel[li].date===f.date&&NB.sel[li].fare===k}" ${soldOut?'disabled':''}><b>${FARE[k]}</b><span>${soldOut?'Agotado':money(f.prices[k])}</span><small>${FARE_INFO[k]}</small></button>`}).join('')}</div></div>`}).join('')+`</div></section>`}).join('');
  if(ready){
    h+=`<section class="card"><h2>Pasajeros</h2><p class="muted">Nombres tal como aparecen en el pasaporte.</p><div class="pax">`+NB.paxd.map((p,i)=>`<div class="paxrow"><span class="pn">${i+1}</span><label>Nombre<input data-p="${i}" data-k="first" value="${esc(p.first)}"></label><label>Apellido<input data-p="${i}" data-k="last" value="${esc(p.last)}"></label><label class="pclub">N.º BEE CLUB <small>opcional</small><input data-p="${i}" data-k="club" value="${esc(p.club||'')}" placeholder="BEE-000000" autocomplete="off" maxlength="11"></label><label class="chk"><input type="checkbox" data-p="${i}" data-k="inf" ${p.inf?'checked':''}> Bebé en brazos (US$40 por trayecto)</label></div>`).join('')+
      `</div><div class="grid2"><label>Correo del cliente<input type="email" id="cEmail" value="${esc(NB.contact.email)}"></label><label>Teléfono del cliente<input id="cPhone" value="${esc(NB.contact.phone)}"></label></div></section>`;
    // seats
    const li=NB.activeLeg, s=NB.sel[li];
    h+=`<section class="card"><h2>Asientos <small>opcional</small></h2><p class="muted">Si no eliges, el sistema asigna una silla sin costo. Elige un pasajero y toca una silla libre.</p>
     ${NB.routes.length>1?`<div class="seg">${NB.routes.map((r,i)=>`<button type="button" data-legtab="${i}" aria-pressed="${i===li}">${i?'Vuelta':'Ida'} ${r.replace('-',' → ')}</button>`).join('')}</div>`:''}
     <div class="seatwrap"><div><ul class="plist">${NB.paxd.map((p,i)=>`<li><button type="button" data-ap="${i}" aria-pressed="${i===NB.activePax}"><span>${esc(p.first||'Pasajero')} ${esc(p.last||i+1)}</span><b>${NB.seats[li][i]||'—'}</b>${NB.seats[li][i]?`<small>${seatPrice(s.fare,NB.seats[li][i])?money(seatPrice(s.fare,NB.seats[li][i])):'sin costo'}</small>`:''}</button></li>`).join('')}</ul>
     <ul class="zones"><li><i class="z1"></i>Preferente 4–6 · US$25</li><li><i class="z2"></i>Salida 13–14 · US$30</li><li><i class="z3"></i>Delantera 7–12 · US$15</li><li><i class="z4"></i>Central 15–22 · US$12</li><li><i class="z5"></i>Trasera 23–26 · sin costo</li></ul><p class="fine">Plus y Flex incluyen la selección de asiento en cualquier zona de económica. Flex BC: Business incluido. Light, Basic y Classic pagan según la zona.</p></div>
     <div id="smap">${seatMap({fare:s.fare,taken:NB.taken[li],mine:NB.seats[li],activePax:NB.activePax})}</div></div></section>`;
    // extras
    h+=`<section class="card"><h2>Extras</h2><div class="xt"><table><thead><tr><th>Pasajero</th>${NB.routes.map((r,i)=>`<th colspan="4">${i?'Vuelta':'Ida'} · ${FARE[NB.sel[i].fare]}</th>`).join('')}</tr><tr><th></th>${NB.routes.map(()=>'<th>Mano 10 kg<br><small>US$18</small></th><th>Maleta 23 kg<br><small>US$55</small></th><th>2.ª maleta<br><small>US$55</small></th><th>Prioritario<br><small>US$8</small></th>').join('')}</tr></thead><tbody>`+
      NB.paxd.map((p,i)=>`<tr><td>${esc(p.first||'Pasajero')} ${esc(p.last||i+1)}</td>${NB.routes.map((r,l)=>{const f=NB.sel[l].fare,x=NB.extras[l][i]||{};
        const cell=(k,st)=>`<td>${st==='inc'?'<span class="inc">Incluido</span>':st==='off'?'<span class="muted">—</span>':`<input type="checkbox" data-x="${k}" data-l="${l}" data-i="${i}" ${x[k]?'checked':''} aria-label="${k} pasajero ${i+1}">`}</td>`;
        return cell('hand',f==='light'?'opt':'inc')+cell('bag',NO_BAG(f)?'opt':'inc')+cell('bag2',f==='bc'?'inc':NO_BAG(f)&&!x.bag?'off':'opt')+cell('prio',f==='bc'?'inc':'opt')}).join('')}</tr>`).join('')+`</tbody></table></div></section>`;
    h+=`<section class="card"><h2>Pago</h2><div class="pay"><label class="opt"><input type="radio" name="pay" value="cash" ${NB.pay==='cash'?'checked':''}><span><b>Cobro en agencia</b><small>El cliente ya te pagó. La reserva se emite de inmediato y el valor queda en tu saldo por consignar a Beemo Air cada semana.</small></span></label>
     <label class="opt"><input type="radio" name="pay" value="hold" ${NB.pay==='hold'?'checked':''}><span><b>Apartar sin pago</b><small>Las sillas quedan apartadas 24 horas (o hasta 3 horas antes del vuelo). Cuando el cliente te pague, registra el pago en Mis reservas; si no, se liberan solas.</small></span></label>
     <label class="opt"><input type="radio" name="pay" value="card" ${NB.pay==='card'?'checked':''}><span><b>Tarjeta del cliente</b><small>Se genera un enlace de pago seguro. Las sillas quedan apartadas hasta que se pague.</small></span></label></div>
     <div id="qbox" class="qbox"></div><p class="note" id="bookN" hidden></p><button class="btn lime big" id="bookBtn">Confirmar reserva</button></section>`;
  }
  box.innerHTML=h;
  // en teléfono cada vuelo muestra sus tarifas al tocarlo (uno abierto a la vez)
  $$('[data-flx]',box).forEach(b=>b.onclick=()=>{const fl=b.closest('.fl'),on=!fl.classList.contains('open'),y0=b.getBoundingClientRect().top;NB.open=NB.open||[];
    $$('.fl.open',fl.parentElement).forEach(x=>{x.classList.remove('open');const t=$('[data-flx]',x);if(t)t.setAttribute('aria-expanded','false')});
    fl.classList.toggle('open',on);b.setAttribute('aria-expanded',String(on));NB.open[+b.dataset.flx]=on?fl.dataset.date:'';
    const dy=b.getBoundingClientRect().top-y0;if(dy)scrollBy(0,dy)});   // el vuelo tocado no se mueve bajo el dedo cuando se pliega el anterior
  $$('.fare',box).forEach(b=>b.onclick=()=>{const li=+b.dataset.leg;const prev=NB.sel[li].date,had=!!NB.sel[li].fare;NB.sel[li]={date:b.dataset.date,fare:b.dataset.fare};if(prev!==b.dataset.date||true){NB.seats[li]=[];NB.extras[li]=[]}
    const next=d=>{const x=new Date(d+'T12:00:00Z');x.setUTCDate(x.getUTCDate()+1);return x.toISOString().slice(0,10)};
    const more=li===0&&NB.routes.length>1?api(`/agency/flights?route=${NB.routes[1]}&from=${next(NB.sel[0].date)}&n=10`).then(r=>{NB.legs[1]=r;if(NB.sel[1].date&&NB.sel[1].date<=NB.sel[0].date){NB.sel[1]={date:null,fare:null};NB.seats[1]=[];NB.extras[1]=[]}}).catch(()=>{}):Promise.resolve();
    Promise.all([loadTaken(li),more]).then(()=>{if(had)keep(renderNB);else{renderNB();nbNext()}quote()})});
  $$('[data-chgleg]',box).forEach(b=>b.onclick=()=>{const li=+b.dataset.chgleg;NB.open=NB.open||[];NB.open[li]=NB.sel[li].date;NB.sel[li]={date:null,fare:null};NB.seats[li]=[];NB.extras[li]=[];if(li===0&&NB.sel[1]){NB.sel[1]={date:null,fare:null};NB.seats[1]=[];NB.extras[1]=[]}renderNB()});
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
  pax:NB.paxd.map(p=>({first:p.first||'X',last:p.last||'X',inf:p.inf,...(CLUB_RE.test((p.club||'').trim())&&!p.inf?{club:p.club.trim()}:{})})),contact:{email:NB.contact.email||'cotizacion@beemoair.com',phone:NB.contact.phone},pay:NB.pay}}
let qt=0;
async function quote(){const box=$('#qbox');if(!box)return;const my=++qt;
  try{const b=await api('/agency/quote',{body:payload()});if(my!==qt)return;
    box.innerHTML=`<table class="sum"><tr><td>Tarifas (${NB.pax} ${NB.pax>1?'pasajeros':'pasajero'}, impuestos incluidos)</td><td>${money(b.fares)}</td></tr>${b.seats?`<tr><td>Asientos</td><td>${money(b.seats)}</td></tr>`:''}${b.extras?`<tr><td>Extras</td><td>${money(b.extras)}</td></tr>`:''}${b.infants?`<tr><td>Bebés en brazos</td><td>${money(b.infants)}</td></tr>`:''}<tr class="tot"><td>Total a cobrar al cliente</td><td>${money(b.total)}</td></tr><tr class="com"><td>Tu comisión (${b.rate} % de la tarifa neta)</td><td>${money(b.commission)}</td></tr></table>`}
  catch(e){if(my===qt)box.innerHTML=`<p class="muted">${esc(e.message)}</p>`}}
async function book(){
  const n=$('#bookN');note(n,'');
  const miss=NB.paxd.findIndex(p=>!p.first||!p.last); if(miss>=0) return note(n,`Falta el nombre o el apellido del pasajero ${miss+1}.`,'err');
  const badc=NB.paxd.findIndex(p=>(p.club||'').trim()&&!CLUB_RE.test(p.club.trim())); if(badc>=0) return note(n,`El número BEE CLUB del pasajero ${badc+1} no es válido: son las letras BEE y 6 dígitos. Corrígelo o déjalo en blanco.`,'err');
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(NB.contact.email)) return note(n,'Escribe el correo del cliente: ahí recibe su reserva.','err');
  const btn=$('#bookBtn');btn.disabled=true;btn.textContent='Reservando…';
  try{const r=await api('/agency/bookings',{body:payload()});NB.done=r;showDone(r);resetNB()}
  catch(e){note(n,e.message,'err');btn.disabled=false;btn.textContent='Confirmar reserva';
    if(e.data&&e.data.code==='seat_taken'){await Promise.all(NB.routes.map((_,i)=>loadTaken(i)));NB.routes.forEach((_,i)=>NB.seats[i]=NB.seats[i].map(s=>s&&NB.taken[i].has(s)?undefined:s));keep(renderNB);note($('#bookN'),e.message,'err')}}
}
function showDone(r){
  $('#main').innerHTML=`<section class="card done"><p class="kick">${r.status==='confirmed'?'Reserva emitida':'Reserva creada · pendiente de pago'}</p><p class="pnr">${r.pnr}</p>
   ${legsTable(r)}${r.status==='pending'?`<p>Las sillas quedan apartadas hasta el <b>${fmtDT(r.expires)}</b>. ${r.pay_method==='cash'?'Cuando el cliente te pague, entra a <a href="#reservas">Mis reservas</a> y toca «Registrar pago»: la reserva se emite. Si no se paga antes de esa hora, las sillas se liberan.':r.pay_url?'Envía este enlace de pago al cliente:':'La pasarela de pago aún no está activa: Beemo Air confirmará el pago manualmente.'}</p>${r.pay_url?`<div class="link"><input readonly value="${esc(r.pay_url)}"><button class="btn ghost sm" id="cp">Copiar</button></div>`:''}`:
   `<p>Total cobrado por tu agencia: <b>${money(r.total)}</b>. Queda en tu saldo por consignar.</p>`}
   <p class="muted">Tu comisión: ${money(r.commission)}.</p><div class="acts"><button class="btn lime" id="again">Nueva reserva</button><a class="btn ghost" href="#reservas">Ver mis reservas</a></div></section>`;
  $('#again').onclick=()=>viewNew(); const cp=$('#cp'); if(cp) cp.onclick=()=>{navigator.clipboard&&navigator.clipboard.writeText(r.pay_url);cp.textContent='Copiado'};
}
function legsTable(b){return `<table class="sum">${b.legs.map(l=>`<tr><td><b>${l.route.replace('-',' → ')}</b> · ${l.no}<br><span class="muted">${fmtD(l.date,{weekday:'long',day:'numeric',month:'long'})} · ${l.dep}–${l.arr} · ${FARE[l.fare]}</span></td><td>${l.seats.join(', ')}</td></tr>`).join('')}
  <tr><td colspan="2" class="muted">${b.pax.map(p=>esc(p.first+' '+p.last)+(p.inf?' (+ bebé)':'')).join(' · ')}</td></tr></table>`}

/* ---------- agent: bookings & statement ---------- */
/* ---------- Mis reservas: filtros por vuelo, resumen, edición antes del pago y cambio de fecha después ---------- */
let BKF={flight:'',status:'',q:''}, BKA=null, BKAN=25, BKX=false;   // filtros, reservas cargadas, filas visibles y pendientes desplegadas
const XP={hand:18,bag:55,bag2:55,prio:8}, XL={hand:'Equipaje de mano 10 kg',bag:'Maleta 23 kg',bag2:'2.ª maleta 23 kg',prio:'Embarque prioritario'};
const legTxt=l=>`${l.route.replace('-','→')} ${fmtD(l.date,{weekday:'short',day:'numeric',month:'short'})}`;
async function viewBookings(){
  shell(agentTabs,'reservas',`<div id="blx"></div><section class="card"><h1>Mis reservas</h1><p class="note" id="bmsg" hidden></p><div id="bfl"></div><div id="bsum"></div><div id="bl"><p class="muted">Cargando…</p></div></section><div id="bed"></div>`);
  agentAlerts();
  BKA=await api('/agency/bookings'); BKAN=25;
  drawBookings();
}
// vuelve a pedir las reservas y redibuja sin recargar la pestaña ni perder el punto de lectura
async function reloadBookings(msg){
  BKA=await api('/agency/bookings'); keep(drawBookings);
  const m=$('#bmsg'); if(m&&msg){note(m,msg,'ok');const r=m.getBoundingClientRect();if(r.top<70||r.bottom>innerHeight)scrollTo({top:Math.max(0,r.top+scrollY-110),behavior:RM?'auto':'smooth'})}
}
function bindBookRows(root){
  const list=BKA||[];
  $$('[data-cancel]',root).forEach(b=>b.onclick=async()=>{if(!confirm(`¿Anular la reserva ${b.dataset.cancel}? Las sillas se liberan.`))return;try{await api(`/agency/bookings/${b.dataset.cancel}/cancel`,{body:{}});await reloadBookings(`Reserva ${b.dataset.cancel} anulada. Las sillas quedaron libres.`)}catch(e){alert(e.message)}});
  $$('[data-cp]',root).forEach(b=>b.onclick=()=>{navigator.clipboard&&navigator.clipboard.writeText(b.dataset.cp);b.textContent='Copiado'});
  $$('[data-edit]',root).forEach(b=>b.onclick=()=>bookingEditor(list.find(x=>x.pnr===b.dataset.edit)));
  $$('[data-chg]',root).forEach(b=>b.onclick=()=>bookingChange(list.find(x=>x.pnr===b.dataset.chg)));
  $$('[data-up]',root).forEach(b=>b.onclick=()=>bookingUpgrade(list.find(x=>x.pnr===b.dataset.up)));
  $$('[data-col]',root).forEach(b=>b.onclick=async()=>{if(!confirm(`¿El cliente ya te pagó ${money(+b.dataset.tot)} de la reserva ${b.dataset.col}? La reserva se emite y el valor pasa a tu saldo por consignar a Beemo Air.`))return;try{await api(`/agency/bookings/${b.dataset.col}/collect`,{body:{}});await reloadBookings(`Reserva ${b.dataset.col} emitida. El valor quedó en tu saldo por consignar.`)}catch(e){alert(e.message)}});
}
// pendientes de pago, filtros y lista; los filtros solo redibujan la lista
function drawBookings(){
  const list=BKA||[], bl=$('#bl'), bx=$('#blx'); if(!bl) return;
  bx.innerHTML=expiringCard(list,BKX?0:3); bindBookRows(bx);
  const xm=$('#expMore'); if(xm) xm.onclick=()=>{BKX=!BKX;keep(drawBookings)};
  if(!list.length){$('#bfl').innerHTML='';$('#bsum').innerHTML='';bl.innerHTML='<p class="muted">Aún no tienes reservas. <a href="#nueva">Crea la primera</a>.</p>';return}
  // vuelos con reservas de la agencia
  const fl={};list.forEach(b=>b.legs.forEach(l=>{const k=l.route+'|'+l.date;fl[k]=fl[k]||{k,l,n:0};fl[k].n++}));
  const flights=Object.values(fl).sort((a,b)=>a.l.date.localeCompare(b.l.date)||a.l.route.localeCompare(b.l.route));
  if(BKF.flight&&!fl[BKF.flight])BKF.flight='';
  const SF=[['','Todas'],['confirmed','Emitidas'],['pending','Pendientes de pago'],['off','Anuladas o vencidas']];
  $('#bfl').innerHTML=`<div class="bfl"><label>Buscar<input id="bfQ" type="search" placeholder="Código, pasajero o correo" value="${esc(BKF.q||'')}" autocomplete="off"></label>
   <label>Vuelo<select id="bfF"><option value="">Todos los vuelos</option>${flights.map(f=>`<option value="${f.k}" ${f.k===BKF.flight?'selected':''}>${legTxt(f.l)} · ${f.l.no||''} · ${f.n} ${f.n===1?'reserva':'reservas'}</option>`).join('')}</select></label>
   <div class="seg" role="group" aria-label="Estado">${SF.map(([k,t])=>`<button type="button" data-bs="${k}" aria-pressed="${k===BKF.status}">${t}</button>`).join('')}</div></div>`;
  let tm; $('#bfQ').oninput=e=>{clearTimeout(tm);const v=e.target.value;tm=setTimeout(()=>{BKF.q=v;BKAN=25;drawBookList()},200)};
  $('#bfF').onchange=e=>{BKF.flight=e.target.value;BKAN=25;drawBookList()};
  $$('[data-bs]').forEach(b=>b.onclick=()=>{BKF.status=b.dataset.bs;BKAN=25;$$('[data-bs]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));drawBookList()});
  drawBookList();
}
function drawBookList(){
  const list=BKA||[], bl=$('#bl'); if(!bl) return;
  const term=normTxt(BKF.q), inF=b=>!BKF.flight||b.legs.some(l=>l.route+'|'+l.date===BKF.flight);
  const inQ=b=>!term||normTxt(b.pnr).includes(term)||normTxt((b.contact||{}).email).includes(term)||b.pax.some(p=>normTxt(p.first+' '+p.last).includes(term));
  const L=list.filter(b=>inF(b)&&inQ(b)), by=k=>L.filter(b=>k==='off'?['cancelled','expired'].includes(b.status):b.status===k);
  const ok=by('confirmed'), pe=by('pending'), off=by('off'), pax=a=>a.reduce((t,b)=>t+b.pax.length,0), sum=(a,f)=>a.reduce((t,b)=>t+f(b),0), scoped=BKF.flight||term;
  $('#bsum').innerHTML=`<ul class="bsum">
   <li class="ok"><i></i><span>Vendidas</span>${fxCount(ok.length)}<small>${pax(ok)} ${pax(ok)===1?'pasajero':'pasajeros'} · ${money(sum(ok,b=>b.total))}</small></li>
   <li class="pe"><i></i><span>Pendientes de pago</span>${fxCount(pe.length)}<small>${pax(pe)} ${pax(pe)===1?'pasajero':'pasajeros'} · ${money(sum(pe,b=>b.due||b.total))} por cobrar</small></li>
   <li class="off"><i></i><span>Anuladas o vencidas</span>${fxCount(off.length)}<small>sillas liberadas</small></li>
   <li class="cm"><i></i><span>Tu comisión</span>${fxCount(sum(ok,b=>b.commission),'money')}<small>de las reservas vendidas${scoped?' con estos filtros':''}</small></li></ul>`;
  const rows=BKF.status?by(BKF.status):L, shown=rows.slice(0,BKAN);
  const canUp=b=>['pending','confirmed'].includes(b.status)&&!b.pass_code&&b.legs.some(l=>l.fare!=='bc'&&new Date(`${l.date}T${l.dep||'00:00'}:00-05:00`)-Date.now()>24*36e5);
  const canChange=b=>b.status==='confirmed'&&!b.pass_code&&b.legs.some(l=>l.fare!=='light'&&new Date(`${l.date}T${l.dep||'00:00'}:00-05:00`)-Date.now()>24*36e5);
  bl.innerHTML=rows.length?`<div class="tw"><table class="tbl rsp bk"><thead><tr><th>Código</th><th>Vuelo</th><th>Pasajeros</th><th>Total</th><th>Comisión</th><th>Pago</th><th>Estado</th><th></th></tr></thead><tbody>${shown.map(b=>`<tr>
   <td class="c-pnr"><b>${b.pnr}</b><br><small class="muted">${fmtDT(b.created)}</small></td><td class="c-fl">${b.legs.map(l=>`${legTxt(l)} <small class="muted">${FARE[l.fare]||''}</small>`).join('<br>')}${(b.changes||[]).map(c=>`<br><small class="chg">${c.kind==='upgrade'?`Mejora ${FARE[c.fare_from]} → ${FARE[c.fare_to]}`:`Cambio ${fmtD(c.from_date,{day:'numeric',month:'short'})} → ${fmtD(c.to_date,{day:'numeric',month:'short'})}`}${c.amount?` · ${money(c.amount)} ${c.pay==='cash'?'en efectivo':c.status==='pending'?'por pagar con tarjeta':'con tarjeta'}`:' · sin cargo'}${c.pay_url?` <button class="btn ghost sm" data-cp="${esc(c.pay_url)}">Enlace</button>`:''}</small>`).join('')}</td>
   <td class="c-px"><span class="c-n">${b.pax.length}</span><br><small class="muted">${b.pax.map(p=>esc(p.first+' '+p.last)).join(', ')}</small></td><td class="c-tot" data-l="Total">${money(b.total)}</td><td class="c-com" data-l="Comisión">${money(b.commission)}</td>
   <td class="c-pay">${payTxt(b)}</td><td class="c-st"><span class="st ${b.status}">${ST[b.status]}</span>${b.status==='pending'&&b.expires?`<br><small class="muted">hasta ${fmtDT(b.expires)}</small>`:''}</td>
   <td class="bact c-act">${b.status==='pending'?`<button class="btn lime sm" data-col="${b.pnr}" data-tot="${b.total}">Registrar pago</button>${b.pass_code?'':`<button class="btn ghost sm" data-edit="${b.pnr}">Editar</button>`}${b.pay_url?`<button class="btn ghost sm" data-cp="${esc(b.pay_url)}">Enlace</button>`:''}<button class="btn ghost sm" data-cancel="${b.pnr}">Anular</button>`:canChange(b)?`<button class="btn ghost sm" data-chg="${b.pnr}">Cambiar fecha</button>`:''}${canUp(b)?`<button class="btn ghost sm" data-up="${b.pnr}">Mejorar tarifa</button>`:''}</td></tr>`).join('')}</tbody></table></div>${moreRow(shown.length,rows.length,'baMore')}`:`<p class="muted">No hay reservas con estos filtros.${term?' Revisa el código o el nombre que escribiste.':''}</p>`;
  const m=$('#baMore'); if(m) m.onclick=()=>{BKAN+=25;keep(drawBookList)};
  bindBookRows(bl);
}
// pie de una lista larga: cuántas se ven y botón para ver más
const moreRow=(shown,total,id,step=25)=>total>shown?`<p class="more"><button type="button" class="btn ghost" id="${id}">Ver ${Math.min(step,total-shown)} más</button><span class="fine">Mostrando ${shown} de ${total}</span></p>`:total>step?`<p class="more"><span class="fine">Mostrando ${total} de ${total}.</span></p>`:'';
const payTxt=b=>b.status==='pending'?(b.pay_method==='cash'?'Apartada · cobro en agencia':'Tarjeta · enlace'):b.pay_method==='cash'?(b.settled?'Agencia · consignado':'Agencia · por consignar'):'Tarjeta';
// editor de una reserva pendiente
function bookingEditor(b){
  const box=$('#bed'); let P=b.pax.map((p,i)=>({first:p.first,last:p.last,inf:!!p.inf,club:p.club||'',from:i})), X=b.legs.map(l=>b.pax.map((_,i)=>({...((l.extras||[])[i]||{})}))), C={...(b.contact||{})}, T=0;
  const opts=f=>f==='bc'?[]:f==='light'?['hand','bag','bag2','prio']:NO_BAG(f)?['bag','bag2','prio']:['bag2','prio'];
  const draw=()=>{box.innerHTML=`<section class="card bedit"><div class="hd"><div><h2>Editar reserva ${b.pnr}</h2><p class="muted">Antes del pago puedes corregir nombres, agregar o quitar pasajeros y maletas. Las sillas que ya tienen se conservan; a los pasajeros nuevos se les asigna una.</p></div><button class="btn ghost sm" id="beX">Cerrar</button></div>
   <h3>Pasajeros</h3><div class="bpax">${P.map((p,i)=>`<div class="bp" data-i="${i}"><span class="bpn">${i+1}</span><label>Nombre<input data-k="first" value="${esc(p.first)}"></label><label>Apellido<input data-k="last" value="${esc(p.last)}"></label><label class="chk"><input type="checkbox" data-k="inf" ${p.inf?'checked':''}> Bebé en brazos</label>${P.length>1?`<button type="button" class="btn ghost sm" data-rm="${i}">Quitar</button>`:''}</div>`).join('')}</div>
   ${P.length<9?'<button type="button" class="btn ghost sm" id="beAdd">Agregar pasajero</button>':''}
   <p class="fine">Escribe los nombres tal como aparecen en el pasaporte.</p>
   ${b.legs.map((l,li)=>`<h3>Equipaje y extras · ${legTxt(l)} · ${FARE[l.fare]}</h3>${l.fare==='bc'?'<p class="muted">Flex BC ya incluye dos maletas de 23 kg.</p>':`<div class="tw"><table class="tbl bx"><thead><tr><th>Pasajero</th>${opts(l.fare).map(k=>`<th>${XL[k]} <small class="muted">+US$${XP[k]}</small></th>`).join('')}</tr></thead><tbody>${P.map((p,i)=>`<tr><td>${esc(p.first||'Pasajero '+(i+1))}</td>${opts(l.fare).map(k=>`<td><input type="checkbox" data-x="${li}|${i}|${k}" ${X[li][i]&&X[li][i][k]?'checked':''} aria-label="${XL[k]} para ${esc(p.first||'pasajero '+(i+1))}"></td>`).join('')}</tr>`).join('')}</tbody></table></div>${NO_BAG(l.fare)?'<p class="fine">La 2.ª maleta requiere la primera.</p>':`<p class="fine">${FARE[l.fare]} ya incluye el equipaje de mano y la maleta de bodega.</p>`}`}`).join('')}
   <h3>Contacto</h3><div class="bcon"><label>Correo<input id="beE" type="email" value="${esc(C.email||'')}"></label><label>Teléfono<input id="beT" value="${esc(C.phone||'')}"></label></div>
   <div class="btot" id="beQ"><p class="muted">Calculando…</p></div>
   <div class="acts"><button class="btn lime" id="beS">Guardar cambios</button><button class="btn ghost" id="beC">Cancelar</button></div><p class="note" id="beN" hidden></p></section>`;
    $('#beX').onclick=$('#beC').onclick=()=>{box.innerHTML=''};
    $$('.bp input',box).forEach(inp=>inp.oninput=inp.onchange=()=>{const i=+inp.closest('.bp').dataset.i,k=inp.dataset.k;P[i][k]=inp.type==='checkbox'?inp.checked:inp.value;if(k==='first')$$('.bx tbody tr',box).forEach((tr,ri)=>{if(ri%P.length===i)tr.cells[0].textContent=P[i].first||'Pasajero '+(i+1)});later()});
    $$('[data-rm]',box).forEach(x=>x.onclick=()=>{const i=+x.dataset.rm;P.splice(i,1);X.forEach(a=>a.splice(i,1));draw()});
    const ad=$('#beAdd');if(ad)ad.onclick=()=>{P.push({first:'',last:'',inf:false,club:'',from:null});X.forEach(a=>a.push({}));draw();$$('.bp',box).pop().querySelector('input').focus()};
    $$('[data-x]',box).forEach(c=>c.onchange=()=>{const [li,i,k]=c.dataset.x.split('|');const o=X[+li][+i];o[k]=c.checked;if(k==='bag'&&!c.checked)o.bag2=false;if(k==='bag2'&&c.checked&&NO_BAG(b.legs[+li].fare))o.bag=true;draw()});
    $('#beE').oninput=e=>{C.email=e.target.value;later()};$('#beT').oninput=e=>{C.phone=e.target.value};
    $('#beS').onclick=save; quote(); box.scrollIntoView({behavior:'smooth',block:'start'});
  };
  const body=extra=>({pax:P.map(p=>({first:p.first.trim(),last:p.last.trim(),inf:p.inf,club:p.club||undefined,from:p.from})),extras:X,contact:C,...extra});
  const later=()=>{clearTimeout(T);T=setTimeout(quote,450)};
  async function quote(){const q=$('#beQ');if(!q)return;if(P.some(p=>!p.first.trim()||!p.last.trim())){q.innerHTML='<p class="muted">Completa nombre y apellido de cada pasajero para ver el nuevo total.</p>';return}
    try{const r=await api(`/agency/bookings/${b.pnr}/edit`,{body:body({preview:true})});const d=r.total-r.old_total;
      q.innerHTML=`<div><span>Total anterior</span><b>${money(r.old_total)}</b></div><div><span>Nuevo total</span><b>${money(r.total)}</b></div><div class="${d>0?'up':d<0?'down':''}"><span>Diferencia</span><b>${d>0?'+':''}${money(d)}</b></div><div><span>Tu comisión</span><b>${money(r.commission)}</b></div>`}
    catch(e){q.innerHTML=`<p class="note err" style="display:block">${esc(e.message)}</p>`}}
  async function save(){const n=$('#beN');try{$('#beS').disabled=true;await api(`/agency/bookings/${b.pnr}/edit`,{body:body()});box.innerHTML='';await reloadBookings(`Reserva ${b.pnr} actualizada. Si el cliente paga con tarjeta, el enlace de pago ya tiene el nuevo total.`)}catch(e){$('#beS').disabled=false;note(n,e.message,'err')}}
  draw();
}
// mejora de tarifa: Classic → Flex o Flex BC, Flex → Flex BC (Business necesita sillas libres en la cabina)
function bookingUpgrade(b){
  const box=$('#bed'),FNm=FARE,R=FRANK;
  const legs=b.legs.map((l,i)=>({...l,i})).filter(l=>l.fare!=='bc'&&new Date(`${l.date}T${l.dep||'00:00'}:00-05:00`)-Date.now()>24*36e5);
  let li=legs[0].i, fare=null, chosen=null, pay='cash';
  const DESC={basic:'Suma el equipaje de mano de 10 kg.',classic:'Suma equipaje de mano y una maleta de 23 kg.',plus:'Maleta de 23 kg, asiento incluido y un cambio sin penalidad.',flex:'Maleta de 30 kg, asiento incluido y cambios sin cargo.',bc:'Cabina Business de 12 asientos, dos maletas de 30 kg y cambios sin cargo.'};
  async function draw(){const l=b.legs[li];
    box.innerHTML=`<section class="card bedit"><div class="hd"><div><h2>Mejorar tarifa · ${b.pnr}</h2><p class="muted">Se cobra la diferencia entre la tarifa actual y la nueva, por pasajero y por tramo. Se puede hasta 24 horas antes de la salida.${b.status==='pending'?' Como la reserva aún no está pagada, la mejora se suma a su total y al enlace de pago.':''}</p></div><button class="btn ghost sm" id="upX">Cerrar</button></div>
     ${b.legs.length>1?`<div class="seg" role="group" aria-label="Tramo">${b.legs.map((x,i)=>`<button type="button" data-lg="${i}" aria-pressed="${i===li}" ${legs.some(y=>y.i===i)?'':'disabled'}>${i?'Regreso':'Ida'} · ${legTxt(x)} · ${FNm[x.fare]}</button>`).join('')}</div>`:''}
     <p>Tarifa actual: <b>${FNm[l.fare]}</b> · ${legTxt(l)} · ${b.pax.length} ${b.pax.length===1?'pasajero':'pasajeros'}</p>
     <div class="upf" id="upF"><p class="muted">Consultando precios y sillas…</p></div><div id="upQ"></div></section>`;
    $('#upX').onclick=()=>{box.innerHTML=''};$$('[data-lg]',box).forEach(x=>x.onclick=()=>{li=+x.dataset.lg;fare=null;chosen=null;draw()});
    box.scrollIntoView({behavior:'smooth',block:'start'});
    const opts=FARE_KEYS.filter(f=>R[f]>R[l.fare]), res={};
    for(const f of opts){try{res[f]=await api(`/agency/bookings/${b.pnr}/upgrade`,{body:{leg:li,fare:f,preview:true}})}catch(e){res[f]={err:e.message}}}
    $('#upF').innerHTML=opts.map(f=>{const r=res[f];return `<button type="button" class="upo" data-fare="${f}" ${r.err?'disabled':''} aria-pressed="${f===fare}"><b>${FNm[f]}</b><span>${r.err?'No disponible':`${money(r.unit)} por pasajero · ${money(r.amount)} en total`}</span><small>${r.err?esc(r.err):DESC[f]+(f==='bc'?` ${r.biz_free} ${r.biz_free===1?'silla libre':'sillas libres'} en Business.`:'')}</small></button>`}).join('');
    $$('[data-fare]',box).forEach(x=>x.onclick=()=>{fare=x.dataset.fare;chosen=null;$$('[data-fare]',box).forEach(y=>y.setAttribute('aria-pressed',String(y===x)));quote()});
    if(fare)quote();
  }
  async function quote(){const q=$('#upQ');q.innerHTML='<p class="muted">Calculando…</p>';
    try{const r=await api(`/agency/bookings/${b.pnr}/upgrade`,{body:{leg:li,fare,preview:true,seats:chosen||undefined}});
      q.innerHTML=`<div class="btot"><div><span>Mejora a ${FNm[fare]}</span><b>${money(r.unit)}</b><small>por pasajero</small></div><div class="up"><span>Total a cobrar</span><b>${money(r.amount)}</b><small>${r.pax} ${r.pax===1?'pasajero':'pasajeros'}</small></div></div>
       ${fare==='bc'?`<div class="bseats"><h3>Sillas en Business</h3><ul>${r.seats.map((x,i)=>`<li><span>${esc(b.pax[i].first)} ${esc(b.pax[i].last)}</span><b>${x.from||'—'} → ${x.to}</b></li>`).join('')}</ul><p class="fine">${r.custom?'Sillas elegidas por ti.':'Propuesta automática: juntas en la cabina Business.'} Las sillas de económica se liberan al confirmar.</p><div class="acts"><button type="button" class="btn ghost sm" id="upPick">Elegir otras sillas</button>${r.custom?'<button type="button" class="btn ghost sm" id="upAuto">Volver a la propuesta</button>':''}</div><div id="upMap"></div></div>`:'<p class="fine">Los pasajeros conservan sus sillas. Los extras que la nueva tarifa ya incluye (equipaje de mano o maleta) quedan incluidos y no se reembolsan.</p>'}
       ${b.status==='confirmed'?`<div class="bpay"><label class="chk"><input type="radio" name="upp" value="cash" ${pay==='cash'?'checked':''}> Lo cobro en la agencia (se suma a tu próxima consignación)</label><label class="chk"><input type="radio" name="upp" value="card" ${pay==='card'?'checked':''}> El cliente paga con tarjeta (enlace de pago)</label></div>`:''}
       <div class="acts"><button class="btn lime" id="upS">Confirmar mejora a ${FNm[fare]} · ${money(r.amount)}</button></div><p class="note" id="upN" hidden></p>`;
      $$('[name=upp]',q).forEach(x=>x.onchange=()=>{pay=x.value});
      const au=$('#upAuto');if(au)au.onclick=()=>{chosen=null;quote()};
      const pk=$('#upPick');if(pk)pk.onclick=()=>pickBiz(r.seats.map(x=>x.to));
      $('#upS').onclick=async()=>{if(!confirm(`¿Mejorar la reserva ${b.pnr} a ${FNm[fare]} por ${money(r.amount)}?`))return;
        try{$('#upS').disabled=true;await api(`/agency/bookings/${b.pnr}/upgrade`,{body:{leg:li,fare,pay,seats:chosen||undefined}});box.innerHTML='';await reloadBookings(`Listo: la reserva ${b.pnr} quedó en ${FNm[fare]}${fare==='bc'?' con sillas en Business':''}. ${b.status==='pending'?'El enlace de pago ya tiene el nuevo total.':pay==='cash'?`Cobra ${money(r.amount)} al cliente; se suma a tu próxima consignación.`:`Cobro de ${money(r.amount)} con tarjeta registrado.`}`)}
        catch(e){$('#upS').disabled=false;note($('#upN'),e.message,'err')}}}
    catch(e){q.innerHTML=`<p class="note err" style="display:block">${esc(e.message)}</p>`}}
  async function pickBiz(start){const l=b.legs[li],m=$('#upMap');m.innerHTML='<p class="muted">Cargando el avión…</p>';
    const f=await api(`/agency/flight?route=${l.route}&date=${l.date}`),own=new Set(l.seats),sel=start.slice(),taken=new Set(f.seats.map(x=>x.seat).filter(x=>!sel.includes(x)&&!own.has(x)));let ap=0;
    const paint=()=>{m.innerHTML=`<div class="bpick"><div class="seg" role="group" aria-label="Pasajero">${b.pax.map((p,i)=>`<button type="button" data-ap="${i}" aria-pressed="${i===ap}">${i+1}. ${esc(p.first)} · ${sel[i]}</button>`).join('')}</div>
      <p class="fine">Toca una silla libre de Business (filas 1–3) para ${esc(b.pax[ap].first)}.</p><div class="smap">${seatMap({fare:'bc',taken,mine:sel,activePax:ap})}</div>
      <div class="acts"><button type="button" class="btn lime sm" id="upUse">Usar estas sillas</button><button type="button" class="btn ghost sm" id="upCx">Cancelar</button></div></div>`;
      $$('[data-ap]',m).forEach(x=>x.onclick=()=>{ap=+x.dataset.ap;paint()});
      $$('[data-seat]',m).forEach(x=>x.onclick=()=>{const id=x.dataset.seat,ow=sel.indexOf(id);if(parseInt(id)>BIZ||taken.has(id)||(ow>=0&&ow!==ap))return;sel[ap]=id;if(ap<sel.length-1)ap++;paint()});
      $('#upUse').onclick=()=>{chosen=sel.slice();quote()};$('#upCx').onclick=()=>{m.innerHTML=''}};
    paint();m.scrollIntoView({behavior:'smooth',block:'nearest'})}
  draw();
}
// cambio de fecha de una reserva emitida
async function bookingChange(b){
  const box=$('#bed'); const legs=b.legs.map((l,i)=>({...l,i})).filter(l=>l.fare!=='light'&&new Date(`${l.date}T${l.dep||'00:00'}:00-05:00`)-Date.now()>24*36e5);
  let li=legs[0].i, pick=null, pay='cash', chosen=null;
  const rule=f=>['basic','classic'].includes(f)?`${FARE[f]}: penalidad de US$175 por pasajero, más la diferencia de tarifa si la nueva fecha es más cara.`:f==='plus'?'Plus: el primer cambio es sin penalidad (luego US$175 por pasajero), más la diferencia de tarifa si la nueva fecha es más cara.':'Flex y Flex BC: cambio sin cargo; solo se cobra la diferencia de tarifa si la nueva fecha es más cara.';
  async function draw(){const l=b.legs[li];
    box.innerHTML=`<section class="card bedit"><div class="hd"><div><h2>Cambiar fecha · ${b.pnr}</h2><p class="muted">${rule(l.fare)} Los cambios se hacen hasta 24 horas antes de la salida.</p></div><button class="btn ghost sm" id="bcX">Cerrar</button></div>
     ${b.legs.length>1?`<div class="seg" role="group" aria-label="Tramo">${b.legs.map((x,i)=>`<button type="button" data-lg="${i}" aria-pressed="${i===li}" ${legs.some(y=>y.i===i)?'':'disabled'}>${i?'Regreso':'Ida'} · ${legTxt(x)}</button>`).join('')}</div>`:''}
     <p>Fecha actual: <b>${legTxt(l)}</b> · ${b.pax.length} ${b.pax.length===1?'pasajero':'pasajeros'} · ${FARE[l.fare]}</p>
     <h3>Elige la nueva fecha</h3><div class="bdates" id="bcD"><p class="muted">Cargando vuelos…</p></div><div id="bcQ"></div></section>`;
    $('#bcX').onclick=()=>{box.innerHTML=''};$$('[data-lg]',box).forEach(x=>x.onclick=()=>{li=+x.dataset.lg;pick=null;chosen=null;draw()});
    box.scrollIntoView({behavior:'smooth',block:'start'});
    const from=new Date(Date.now()+864e5).toLocaleDateString('en-CA',{timeZone:'America/New_York'});
    const fs=(await api(`/agency/flights?route=${l.route}&from=${from}&n=24`)).filter(f=>f.date!==l.date);
    $('#bcD').innerHTML=fs.length?fs.map(f=>{const free=l.fare==='bc'?f.avail.biz:f.avail.eco,ok=free>=b.pax.length;return `<button type="button" class="bdate" data-dt="${f.date}" ${ok?'':'disabled'} aria-pressed="${f.date===pick}"><b>${fmtD(f.date,{weekday:'short',day:'numeric',month:'short'})}</b><span>${money(f.prices[l.fare])}</span><small>${ok?`${free} libres`:'sin cupo'}</small></button>`}).join(''):'<p class="muted">No hay otras fechas disponibles.</p>';
    $$('[data-dt]',box).forEach(x=>x.onclick=()=>{pick=x.dataset.dt;chosen=null;$$('[data-dt]',box).forEach(y=>y.setAttribute('aria-pressed',String(y===x)));quote()});
    if(pick)quote();
  }
  async function quote(){const q=$('#bcQ');q.innerHTML='<p class="muted">Calculando…</p>';
    try{const r=await api(`/agency/bookings/${b.pnr}/change`,{body:{leg:li,date:pick,preview:true,seats:chosen||undefined}});
      q.innerHTML=`<div class="btot"><div><span>Cargo por cambio</span><b>${money(r.fee)}</b><small>por pasajero</small></div><div><span>Diferencia de tarifa</span><b>${money(r.diff)}</b><small>por pasajero</small></div>${r.seat_diff?`<div><span>Diferencia por sillas</span><b>${money(r.seat_diff)}</b><small>zona de mayor precio</small></div>`:''}<div class="${r.amount?'up':''}"><span>Total a cobrar</span><b>${money(r.amount)}</b><small>${r.pax} ${r.pax===1?'pasajero':'pasajeros'}</small></div></div>
       ${r.amount?`<div class="bpay"><label class="chk"><input type="radio" name="bcp" value="cash" ${pay==='cash'?'checked':''}> Lo cobro en la agencia (se suma a tu próxima consignación)</label><label class="chk"><input type="radio" name="bcp" value="card" ${pay==='card'?'checked':''}> El cliente paga con tarjeta (enlace de pago)</label></div>`:''}
       <div class="bseats"><h3>Sillas en el nuevo vuelo</h3><ul>${r.seats.map((x,i)=>`<li><span>${esc(b.pax[i].first)} ${esc(b.pax[i].last)}</span><b>${x.from||'—'} → ${x.to}</b></li>`).join('')}</ul>
        <p class="fine">${r.custom?'Sillas elegidas por ti. Si alguna es de una zona más cara que la original, se cobra solo la diferencia.':'Propuesta automática sin costo: las mismas sillas si están libres o, si no, juntas y en la misma zona.'}</p>
        <div class="acts"><button type="button" class="btn ghost sm" id="bcPick">Elegir otras sillas</button>${r.custom?'<button type="button" class="btn ghost sm" id="bcAuto">Volver a la propuesta</button>':''}</div><div id="bcMap"></div></div>
       <p class="fine">Tu comisión no cambia.</p>
       <div class="acts"><button class="btn lime" id="bcS">Confirmar cambio a ${fmtD(pick,{weekday:'short',day:'numeric',month:'short'})}${r.amount?` · ${money(r.amount)}`:''}</button></div><p class="note" id="bcN" hidden></p>`;
      $$('[name=bcp]',q).forEach(x=>x.onchange=()=>{pay=x.value});
      const au=$('#bcAuto');if(au)au.onclick=()=>{chosen=null;quote()};
      $('#bcPick').onclick=()=>pickSeats(r.seats.map(x=>x.to));
      $('#bcS').onclick=async()=>{if(!confirm(`¿Cambiar la fecha de la reserva ${b.pnr} al ${fmtD(pick,{weekday:'long',day:'numeric',month:'long'})}?`))return;
        try{$('#bcS').disabled=true;const nb=await api(`/agency/bookings/${b.pnr}/change`,{body:{leg:li,date:pick,pay,seats:chosen||undefined}});box.innerHTML='';const c=nb.changes[nb.changes.length-1];await reloadBookings(`Listo: la reserva ${b.pnr} quedó para el ${fmtD(pick,{weekday:'long',day:'numeric',month:'long'})}.${c&&c.amount?(c.pay==='cash'?` Cobra ${money(c.amount)} al cliente; se suma a tu próxima consignación.`:c.pay_url?` Envía al cliente el enlace de pago de ${money(c.amount)} (botón «Enlace» en la reserva).`:` Beemo Air registrará el pago de ${money(c.amount)} con tarjeta.`):''}`)}
        catch(e){$('#bcS').disabled=false;note($('#bcN'),e.message,'err')}}}
    catch(e){q.innerHTML=`<p class="note err" style="display:block">${esc(e.message)}</p>`}}
  async function pickSeats(start){const l=b.legs[li],m=$('#bcMap');m.innerHTML='<p class="muted">Cargando el avión…</p>';
    const f=await api(`/agency/flight?route=${l.route}&date=${pick}`),sel=start.slice(),taken=new Set(f.seats.map(x=>x.seat).filter(x=>!sel.includes(x)));let ap=0;
    const paint=()=>{m.innerHTML=`<div class="bpick"><div class="seg" role="group" aria-label="Pasajero">${b.pax.map((p,i)=>`<button type="button" data-ap="${i}" aria-pressed="${i===ap}">${i+1}. ${esc(p.first)} · ${sel[i]}</button>`).join('')}</div>
      <p class="fine">Toca una silla libre para ${esc(b.pax[ap].first)}. ${l.fare==='bc'?'Flex BC usa la cabina Business (filas 1–3).':'Las filas con color tienen costo según su zona.'}</p>
      <div class="smap">${seatMap({fare:l.fare,taken,mine:sel,activePax:ap})}</div>
      <div class="acts"><button type="button" class="btn lime sm" id="bcUse">Usar estas sillas</button><button type="button" class="btn ghost sm" id="bcCx">Cancelar</button></div></div>`;
      $$('[data-ap]',m).forEach(x=>x.onclick=()=>{ap=+x.dataset.ap;paint()});
      $$('[data-seat]',m).forEach(x=>x.onclick=()=>{const id=x.dataset.seat,ow=sel.indexOf(id);if(taken.has(id)||(ow>=0&&ow!==ap))return;sel[ap]=id;if(ap<sel.length-1)ap++;paint()});
      $('#bcUse').onclick=()=>{chosen=sel.slice();quote()};$('#bcCx').onclick=()=>{m.innerHTML=''}};
    paint();m.scrollIntoView({behavior:'smooth',block:'nearest'})}
  draw();
}
async function viewStatement(){
  shell(agentTabs,'cuenta',`<section class="card"><h1>Estado de cuenta</h1><div id="stm"><p class="muted">Cargando…</p></div></section><div id="stmx"></div>`);
  agentAlerts();
  const s=await api('/agency/statement'); drawStatementExtras(s);
  const cash=(s.cash_settled||0)+s.cash_due;
  $('#stm').innerHTML=`<div class="fx-grid rs"><div class="fx-cell">${fxGauge({p:cash?(s.cash_settled||0)/cash:1,val:cash?fxCount((s.cash_settled||0)/cash*100,'pct'):'<b>Al día</b>',label:'efectivo consignado',sub:cash?`${money(s.cash_settled||0)} de ${money(cash)}`:'no tienes efectivo por consignar'})}</div>
   <div class="fx-cell">${fxDonut([{v:s.net-s.commission>0?s.net-s.commission:0,cls:'c3',label:'Tarifa neta para Beemo Air',txt:money(Math.max(0,s.net-s.commission))},{v:s.commission,cls:'c1',label:'Tu comisión',txt:money(s.commission)},{v:Math.max(0,s.sales-s.net),cls:'c2',label:'Impuestos, tasas y extras',txt:money(Math.max(0,s.sales-s.net))}],fxCount(s.sales,'usd'),'ventas totales')}</div></div>
   <ul class="kpis"><li>${fxCount(s.bookings)}<span>reservas emitidas</span></li><li>${fxCount(s.sales,'money')}<span>ventas totales</span></li><li>${fxCount(s.commission,'money')}<span>comisión causada (${me.agency.commission+me.agency.incentive} %)</span></li><li class="due">${fxCount(s.cash_due,'money')}<span>por consignar a Beemo Air</span></li></ul>
   <p class="muted">La comisión es del ${me.agency.commission} % de la tarifa neta${me.agency.incentive?` más un incentivo del ${me.agency.incentive} %`:''}, sin impuestos, tasas ni extras. Se liquida cada mes. Lo cobrado en efectivo se consigna cada semana, a más tardar el segundo día hábil de la semana siguiente.</p>
   ${s.pending?`<p>Tienes ${s.pending} ${s.pending>1?'reservas pendientes':'reserva pendiente'} de pago.</p>`:''}`;
}
/* ---------- agencia: Inicio — saludo, próximo vuelo y tablero del negocio ---------- */
let HO=null, HO_R=null, HO_P='mes', HO_M='sales';
const HO_PER=[['mes','Este mes'],['prev','Mes pasado'],['90','90 días'],['ano','Este año']];
const HO_MET=[['sales','Ventas'],['com','Comisión'],['segs','Pasajeros']];
const capFirst=t=>t?t.charAt(0).toUpperCase()+t.slice(1):'';
const isoU=d=>d.toISOString().slice(0,10), dimU=(y,m)=>new Date(Date.UTC(y,m,0)).getUTCDate();
const monL=(k,o={month:'long'})=>{const [y,m]=k.split('-').map(Number);return new Date(Date.UTC(y,m-1,15)).toLocaleDateString('es',{...o,timeZone:'UTC'})};
const addDays=(day,n)=>isoU(new Date(Date.parse(day+'T12:00:00Z')+n*864e5));
// primer nombre de quien entra (si viene en mayúsculas sostenidas, se escribe normal)
function hoName(){const w=String((me.viewer?me.viewer.name:me.name)||'').trim().split(/\s+/)[0]||'';return w&&w===w.toUpperCase()?capFirst(w.toLowerCase()):w}
// periodo elegido y el periodo con el que se compara
function hoRange(k,today){
  const [Y,M,D]=today.split('-').map(Number), U=(y,m,d)=>isoU(new Date(Date.UTC(y,m-1,d))), pm=M===1?[Y-1,12]:[Y,M-1], pp=pm[1]===1?[pm[0]-1,12]:[pm[0],pm[1]-1];
  if(k==='prev') return {a:U(pm[0],pm[1],1),b:U(pm[0],pm[1],dimU(pm[0],pm[1])),pa:U(pp[0],pp[1],1),pb:U(pp[0],pp[1],dimU(pp[0],pp[1])),cmp:`todo ${monL(U(pp[0],pp[1],1))}`};
  if(k==='90') return {a:addDays(today,-89),b:today,pa:addDays(today,-179),pb:addDays(today,-90),cmp:'los 90 días anteriores'};
  if(k==='ano') return {a:`${Y}-01-01`,b:today,pa:`${Y-1}-01-01`,pb:U(Y-1,M,Math.min(D,dimU(Y-1,M))),cmp:`el mismo periodo de ${Y-1}`};
  const d2=Math.min(D,dimU(pm[0],pm[1]));
  return {a:U(Y,M,1),b:today,pa:U(pm[0],pm[1],1),pb:U(pm[0],pm[1],d2),cmp:d2===1?`el 1 de ${monL(U(pm[0],pm[1],1))}`:`del 1 al ${d2} de ${monL(U(pm[0],pm[1],1))}`};
}
function hoStats(rows,a,b){
  const s={n:0,sales:0,com:0,segs:0,lost:0,lostAmt:0,void:0,held:0,heldAmt:0};
  for(const r of rows){if(r.day<a||r.day>b)continue;
    if(r.st==='confirmed'){s.n++;s.sales+=r.total;s.com+=r.com;s.segs+=r.pax*r.legs.length}
    else if(r.st==='expired'){s.lost++;s.lostAmt+=r.total}
    else if(r.st==='cancelled')s.void++;
    else if(r.st==='pending'){s.held++;s.heldAmt+=r.total}}
  s.avg=s.n?s.sales/s.n:0; const tried=s.n+s.lost+s.void; s.close=tried?s.n/tried:null; return s}
function hoDelta(cur,prev){
  if(!prev) return `<span class="ho-d nil">${cur?'Sin datos para comparar':'Sin movimiento'}</span>`;
  const r=Math.round((cur-prev)/prev*100);
  if(!r) return '<span class="ho-d">Igual que antes</span>';
  return `<span class="ho-d ${r>0?'up':'dn'}"><i aria-hidden="true">${r>0?'▲':'▼'}</i>${Math.abs(r).toLocaleString('es-CO')} %<span class="sr"> ${r>0?'más':'menos'} que el periodo anterior</span></span>`}
const hoIco=k=>`<svg viewBox="0 0 24 24" aria-hidden="true">${ICO[k]}</svg>`;
async function viewHome(){
  const today=dayKey(Date.now()), fn=hoName(), ag=me.agency?me.agency.name.replace(/\.$/,''):'';
  shell(agentTabs,'inicio',`<section class="card ho-hero"><div class="ho-top"><div class="ho-hi"><h1>${fn?`Hola, ${esc(fn)}`:'Hola'}</h1><p class="ho-date">${capFirst(fmtD(today,{weekday:'long',day:'numeric',month:'long'}))}${ag?' · '+esc(ag):''}</p><p class="ho-sum" id="hoSum">&nbsp;</p></div>
    <div class="ho-cta"><a class="btn lime" href="#nueva">Nueva reserva</a><a class="btn ghost" href="#reservas">Mis reservas</a></div></div><div id="hoPl" class="ho-pl"></div></section>
   <div class="ho-g1"><section class="card ho-todo" id="hoTd"><h2>Pendientes</h2><p class="muted">Cargando…</p></section><section class="card ho-goal" id="hoGo"><h2>Meta del mes</h2><p class="muted">Cargando…</p></section></div>
   <section class="card ho-num" id="hoN"><h2>Tus números</h2><p class="muted">Cargando…</p></section>
   <div class="ho-g2" id="hoX"></div>
   <section class="card" id="hoM"></section>
   <section class="card" id="hoU"><h2>Próximas salidas con tus pasajeros</h2><p class="muted">Cargando…</p></section>`);
  let res;
  try{res=await Promise.all([api('/agency/dashboard'),api('/agency/statement').catch(()=>null),api('/agency/plan').catch(()=>null),api('/agency/notices').catch(()=>[]),api('/agency/unread').catch(()=>({support:0})),
    ...ROUTES.map(([r])=>api(`/agency/flights?route=${r}&from=${today}&n=6`).catch(()=>[]))])}
  catch(e){const n=$('#hoN');if(n)n.innerHTML=`<h2>Tus números</h2><p class="note err">${esc(e.message)}</p>`;return}
  if(!$('#hoN')||(location.hash.slice(1)||'inicio')!=='inicio') return;
  const [d,st,plan,nt,un,...fl]=res;
  HO={d,rows:d.rows,st,plan,nt,un:un.support||0,fl:Object.fromEntries(ROUTES.map(([r],i)=>[r,fl[i]]))};
  hoPlane();hoSum();hoTodo();hoGoal();hoNums();hoMonthly();hoUpcoming();
}
function hoSum(){
  const el=$('#hoSum'); if(!el) return; const t=dayKey(Date.now()), s=hoStats(HO.rows,t.slice(0,8)+'01',t);
  el.innerHTML=s.n?`Este mes llevas <b>${s.segs} ${s.segs===1?'pasajero':'pasajeros'}</b> y <b>${usd0(s.sales)}</b> en ventas.`:'Aún no tienes reservas emitidas este mes.'}
// el avión del próximo vuelo (antes estaba en «Nueva reserva»)
function hoPlane(){
  const box=$('#hoPl'); if(!box||!HO) return;
  const avail=ROUTES.filter(([r])=>(HO.fl[r]||[]).length);
  if(!HO_R||!(HO.fl[HO_R]||[]).length) HO_R=((avail.find(([r])=>r==='MIA-AXM')||avail[0])||['MIA-AXM'])[0];
  const route=HO_R, [o,d]=route.split('-'), nx=(HO.fl[route]||[])[0];
  const days=nx?Math.max(0,Math.round((Date.parse(nx.date)-Date.parse(new Date().toLocaleDateString('en-CA')))/864e5)):0, free=nx?nx.avail.eco+nx.avail.biz:0, P='M40 104 Q500 -34 960 104';
  box.innerHTML=`<div class="ni-route ho-route${nx?'':' off'}">
   <svg class="ni-arc" viewBox="0 0 1000 120" aria-hidden="true"><path id="hoP" d="${P}" class="ni-p0"/><path d="${P}" class="ni-p1" pathLength="100"/>
    <circle cx="40" cy="104" r="5" class="ni-dot"/><circle cx="40" cy="104" r="5" class="ni-ring"/><circle cx="960" cy="104" r="5" class="ni-dot"/><circle cx="960" cy="104" r="5" class="ni-ring b"/>
    <g class="ni-pl">${RM?'':`<animateMotion dur="9s" repeatCount="indefinite" rotate="auto" keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines=".45 0 .55 1"><mpath href="#hoP"/></animateMotion>`}<path d="M13 0c0 2-7 3.4-13 3.4l-9 10h-4l4-10h-6l-3 4h-3l2-7.4-2-7.4h3l3 4h6l-4-10h4l9 10c6 0 13 1.400 13 3.400z" ${RM?'transform="translate(500 35)"':''}/></g></svg>
   <div class="ni-row"><div class="ni-end"><b>${o}</b><span>${esc(AIR[o]||o)}</span>${nx?`<em>Sale ${nx.dep}</em>`:''}</div>
    <div class="ni-mid">${nx?`<p class="ni-next"><span>Próximo vuelo · ${nx.no}</span><b>${fmtD(nx.date,{weekday:'long',day:'numeric',month:'long'})}</b></p><p class="ni-cd">${days?`en ${fxCount(days)} ${days===1?'día':'días'}`:'sale hoy'} · ${free} ${free===1?'silla libre':'sillas libres'}</p><button type="button" class="btn lime sm" id="hoBook">Reservar en este vuelo</button>`:`<p class="ni-next"><b>Sin vuelos programados en esta ruta</b><span>${avail.length?'Elige otra ruta.':'Beemo Air publicará nuevas fechas pronto.'}</span></p>`}</div>
    <div class="ni-end r"><b>${d}</b><span>${esc(AIR[d]||d)}</span>${nx?`<em>Llega ${nx.arr}</em>`:''}</div></div>
   ${avail.length>1?`<div class="seg ho-rt" role="group" aria-label="Ruta del próximo vuelo">${avail.map(([r])=>`<button type="button" data-hr="${r}" aria-pressed="${r===route}">${r.replace('-',' → ')}</button>`).join('')}</div>`:''}</div>`;
  $$('[data-hr]',box).forEach(b=>b.onclick=()=>{HO_R=b.dataset.hr;hoPlane()});
  const bk=$('#hoBook',box); if(bk) bk.onclick=()=>{resetNB();NB.route=route;NB.from=nx.date;NB.auto=1;location.hash='#nueva'};
}
// lo que la agencia tiene por hacer, en orden de urgencia
function hoTodo(){
  const box=$('#hoTd'); if(!box) return;
  const R=HO.rows, now=Date.now(), today=dayKey(now), wk=addDays(today,7), it=[];
  const held=R.filter(r=>r.st==='pending').sort((a,b)=>(a.exp||'9').localeCompare(b.exp||'9'));
  if(held.length){const f=held[0], urg=f.exp&&Date.parse(f.exp)-now<24*36e5;
    it.push({c:urg?'w':'',i:'reservas',h:'#reservas',t:`<b>${held.length}</b> ${held.length===1?'reserva apartada espera':'reservas apartadas esperan'} pago · ${money(held.reduce((t,r)=>t+r.total,0))}`,s:f.exp?`La primera (${f.pnr}) ${left(f.exp)}. Cobra al cliente y toca «Registrar pago».`:''})}
  const W=(HO.st&&HO.st.cash_weeks)||[], over=W.filter(w=>w.overdue), nw=W.find(w=>!w.overdue);
  if(over.length) it.push({c:'e',i:'cuenta',h:'#cuenta',t:`<b>${money(over.reduce((t,w)=>t+w.amount,0))}</b> por consignar con la fecha vencida`,s:'Consígnalos a Beemo Air lo antes posible.'});
  if(nw) it.push({i:'cuenta',h:'#cuenta',t:`Consigna <b>${money(nw.amount)}</b> a Beemo Air`,s:`A más tardar el ${fmtD(nw.due,{weekday:'long',day:'numeric',month:'long'})}.`});
  const cp=HO.d.changes_pending; if(cp&&cp.n) it.push({i:'reservas',h:'#reservas',t:`<b>${cp.n}</b> ${cp.n===1?'cambio o mejora de tarifa':'cambios o mejoras de tarifa'} por cobrar · ${money(cp.amount)}`,s:'Están en Mis reservas.'});
  const nt=(HO.nt||[]).filter(n=>n.mine||!n.flight); if(nt.length) it.push({c:'i',i:'vuelos',h:'#vuelos',t:`<b>${nt.length}</b> ${nt.length===1?'aviso':'avisos'} de la aerolínea`,s:nt.some(n=>n.mine)?'Hay avisos para vuelos con tus pasajeros.':'Avisos generales vigentes.'});
  if(HO.un) it.push({i:'soporte',h:'#soporte',t:`<b>${HO.un}</b> ${HO.un===1?'mensaje nuevo':'mensajes nuevos'} de Beemo Air`,s:'Respóndelos en Soporte.'});
  let fly=0; for(const r of R) if(r.st==='confirmed') for(const l of r.legs) if(l.d>=today&&l.d<=wk) fly+=r.pax;
  if(fly) it.push({i:'material',h:'#material',t:`<b>${fly}</b> ${fly===1?'pasajero vuela':'pasajeros vuelan'} en los próximos 7 días`,s:'Envíales el recordatorio de viaje que está en Material.'});
  box.innerHTML=`<h2>Pendientes${it.length?` <small>${it.length}</small>`:''}</h2>`+(it.length?`<ul class="ho-tdl">${it.map(x=>`<li><a class="ho-td${x.c?' '+x.c:''}" href="${x.h}"><span class="ho-ti">${hoIco(x.i)}</span><span class="ho-tt"><span>${x.t}</span>${x.s?`<small>${x.s}</small>`:''}</span><svg class="ho-ch" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></a></li>`).join('')}</ul>`
    :`<p class="ho-ok"><span class="ho-ti"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></span><span>Todo al día. No tienes pagos por cobrar, consignaciones ni avisos pendientes.</span></p>`);
}
// meta de ventas del mes que pone la propia agencia, con proyección al cierre y el nivel de incentivo
function hoGoal(){
  const box=$('#hoGo'); if(!box) return;
  const g=+HO.d.goal||0, today=dayKey(Date.now()), [Y,M,D]=today.split('-').map(Number), dim=dimU(Y,M), mes=monL(today), cur=hoStats(HO.rows,today.slice(0,8)+'01',today);
  const proj=cur.sales/D*dim, ro=me.readonly, plan=HO.plan;
  const pm=M===1?`${Y-1}-12`:`${Y}-${String(M-1).padStart(2,'0')}`, last=hoStats(HO.rows,pm+'-01',pm+'-31').sales, sug=Math.max(1000,Math.ceil(last*1.1/500)*500);
  const left_=Math.max(0,g-cur.sales);
  const body=g?`<div class="ho-gw">${fxGauge({small:1,p:cur.sales/g,mark:D/dim,markLabel:'donde deberías ir hoy',val:fxCount(cur.sales/g*100,'pct'),label:'de la meta',sub:`${usd0(cur.sales)} de ${usd0(g)}`})}
     <div class="ho-gt">${cur.sales>=g?`<p><b>Meta cumplida.</b> Llevas ${usd0(cur.sales-g)} por encima.</p>`:`<p>Te faltan <b>${usd0(left_)}</b>${cur.avg?`, unas ${Math.ceil(left_/cur.avg)} ${Math.ceil(left_/cur.avg)===1?'reserva':'reservas'} como tu promedio`:''}.</p>`}
      ${D<dim&&cur.sales?`<p class="muted">A este ritmo cierras ${mes} en <b>${usd0(proj)}</b>${proj>=g?', por encima de la meta.':'.'}</p>`:''}
      ${ro?'':'<button type="button" class="btn ghost sm" id="hoGE">Cambiar meta</button>'}</div></div>`
    :`<p class="muted">Ponle una meta de ventas mensual a tu agencia. Aquí verás cuánto llevas, cuánto te falta y si vas a buen ritmo para cumplirla.</p>`;
  const form=ro?'':`<form id="hoGF" class="ho-gf"${g?' hidden':''}><label>Meta de ventas al mes (US$)<input name="goal" type="number" min="0" step="100" inputmode="numeric" value="${g||''}" placeholder="Ej.: ${sug}" required></label><button class="btn lime sm">Guardar meta</button>${g?'<button type="button" class="btn ghost sm" id="hoGX">Cancelar</button>':''}<p class="note" hidden></p></form>`;
  const rate=plan?plan.commission+plan.incentive:(me.agency?me.agency.commission+(me.agency.incentive||0):0);
  const tier=plan&&plan.tiers&&plan.tiers.length?`<div class="ho-tier"><p class="ho-trh"><span>${plan.next?`Incentivo: <b>${plan.segs}</b> de ${plan.next.min} trayectos este mes para el nivel ${esc(plan.next.name)} (+${String(plan.next.incentive).replace('.',',')} %)`:`Nivel ${esc(plan.current?plan.current.name:'más alto')} alcanzado este mes`}</span><b>${String(rate).replace('.',',')} %</b></p><span class="ho-bar"><i style="width:${plan.next?Math.min(100,plan.segs/plan.next.min*100).toFixed(1):100}%"></i></span></div>`
    :`<p class="fine ho-tier">Tu comisión: ${String(rate).replace('.',',')} % de la tarifa neta de cada boleto.</p>`;
  box.innerHTML=`<h2>Meta de ${mes}</h2>${body}${form}${tier}`;
  const f=$('#hoGF',box); if(!f) return;
  const e=$('#hoGE',box); if(e) e.onclick=()=>{f.hidden=false;e.hidden=true;f.goal.focus()};
  const x=$('#hoGX',box); if(x) x.onclick=()=>{f.hidden=true;if(e)e.hidden=false};
  f.onsubmit=async ev=>{ev.preventDefault();const n=$('.note',f);note(n,'');
    try{const r=await api('/agency/goal',{method:'PUT',body:{goal:f.goal.value}});HO.d.goal=r.goal;hoGoal()}catch(err){note(n,err.message,'err')}};
}
// periodo elegido: cifras, tarifas y asesores; se descarga en CSV
function hoNums(){
  const box=$('#hoN'); if(!box) return;
  const today=dayKey(Date.now()), R=hoRange(HO_P,today), s=hoStats(HO.rows,R.a,R.b), p=hoStats(HO.rows,R.pa,R.pb);
  const span=R.a===R.b?fmtD(R.a,{day:'numeric',month:'long',year:'numeric'}):`Del ${fmtD(R.a,{day:'numeric',month:'short'})} al ${fmtD(R.b,{day:'numeric',month:'short',year:'numeric'})}`;
  box.innerHTML=`<div class="hd ho-nh"><div><h2>Tus números</h2><p class="muted">${span}</p></div>
    <div class="ho-ctl"><div class="seg" role="group" aria-label="Periodo">${HO_PER.map(([k,t])=>`<button type="button" data-hp="${k}" aria-pressed="${k===HO_P}">${t}</button>`).join('')}</div><button type="button" class="btn ghost sm" id="hoCsv">Descargar CSV</button></div></div>
   <ul class="kpis ho-k">
    <li>${fxCount(s.sales,'usd')}<span>ventas</span>${hoDelta(s.sales,p.sales)}</li>
    <li>${fxCount(s.com,'money')}<span>tu comisión</span>${hoDelta(s.com,p.com)}</li>
    <li>${fxCount(s.segs)}<span>pasajeros emitidos (por trayecto)</span>${hoDelta(s.segs,p.segs)}</li>
    <li>${fxCount(s.avg,'usd')}<span>venta promedio por reserva</span>${hoDelta(s.avg,p.avg)}</li></ul>
   <ul class="ho-chips"><li><b>${s.n}</b> ${s.n===1?'reserva emitida':'reservas emitidas'}</li>${s.close!=null?`<li title="Reservas emitidas entre todas las que se crearon en el periodo (emitidas, vencidas y anuladas)"><b>${Math.round(s.close*100)} %</b> de cierre</li>`:''}${s.lost?`<li><b>${s.lost}</b> ${s.lost===1?'venció':'vencieron'} sin pago · ${usd0(s.lostAmt)}</li>`:''}${s.void?`<li><b>${s.void}</b> ${s.void===1?'anulada':'anuladas'}</li>`:''}${s.held?`<li><b>${s.held}</b> ${s.held===1?'sigue apartada':'siguen apartadas'} · ${usd0(s.heldAmt)}</li>`:''}</ul>
   <p class="fine">Ventas y comisión de las reservas emitidas creadas en el periodo, como en tu estado de cuenta. Las flechas comparan con ${R.cmp}.</p>`;
  $$('[data-hp]',box).forEach(b=>b.onclick=()=>{HO_P=b.dataset.hp;hoNums()});
  $('#hoCsv',box).onclick=()=>hoCsv(R);
  hoMix(R);
}
function hoMix(R){
  const box=$('#hoX'); if(!box) return;
  const C=HO.rows.filter(r=>r.st==='confirmed'&&r.day>=R.a&&r.day<=R.b), mix={}, rt={}, by={}; let tot=0;
  for(const r of C){for(const l of r.legs){mix[l.f]=(mix[l.f]||0)+r.pax;rt[l.r]=(rt[l.r]||0)+r.pax;tot+=r.pax}
    const k=r.by||'Sin asesor'; by[k]=by[k]||{n:0,segs:0,sales:0,com:0}; by[k].n++; by[k].segs+=r.pax*r.legs.length; by[k].sales+=r.total; by[k].com+=r.com}
  const pct=v=>tot?` · ${Math.round(v/tot*100)} %`:'';
  const nx=(HO.fl['MIA-AXM']||[])[0], lt=mix.light||0, up=nx&&nx.prices.classic>nx.prices.light?nx.prices.classic-nx.prices.light:0;
  const tip=tot>=4&&lt/tot>=.5&&up?`<p class="ho-tip">La mayoría de tus pasajeros viaja en Light. Ofrecerles Classic, con equipaje de mano y maleta de 23 kg incluidos, sube cada trayecto ${usd0(up)} y tu comisión con él.</p>`:'';
  const empty='<p class="muted">No hay reservas emitidas en este periodo.</p>';
  const fares=`<section class="card"><h2>Tarifas que vendes <small>pasajeros por trayecto</small></h2>${tot?fxBars(FARE_KEYS.map(k=>({n:FARE[k]+pct(mix[k]||0),v:mix[k]||0})),'int')+tip:empty}</section>`;
  const sellers=Object.entries(by).sort((a,b)=>b[1].sales-a[1].sales);
  const smax=Math.max(1,...sellers.map(([,v])=>v.sales));
  const side=(HO.d.sellers||0)>1||sellers.length>1
    ?`<section class="card"><h2>Por asesor</h2>${sellers.length?`<ul class="ho-sl">${sellers.map(([k,v])=>`<li><span class="ho-sn"><b>${esc(k)}</b><small>${v.n} ${v.n===1?'reserva':'reservas'} · ${v.segs} ${v.segs===1?'pasajero':'pasajeros'}</small></span><span class="ho-sv"><b>${money(v.sales)}</b><small>comisión ${money(v.com)}</small></span><span class="ho-bar"><i style="width:${(v.sales/smax*100).toFixed(1)}%"></i></span></li>`).join('')}</ul><p class="fine">Cada reserva cuenta para quien la creó en el portal.</p>`:empty}</section>`
    :`<section class="card"><h2>Rutas <small>pasajeros por trayecto</small></h2>${tot?fxBars(ROUTES.filter(([r])=>rt[r]).map(([r,t])=>({n:t.replace(' (Carnaval)','')+pct(rt[r]),v:rt[r]})),'int'):empty}</section>`;
  box.innerHTML=fares+side;
}
function hoCsv(R){
  const PM={cash:'En agencia',card:'Tarjeta'}, rows=HO.rows.filter(r=>r.day>=R.a&&r.day<=R.b).sort((a,b)=>a.day.localeCompare(b.day)||a.pnr.localeCompare(b.pnr));
  const slug=normTxt(me.agency?me.agency.name:'agencia').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'agencia';
  csvDownload(`beemo-${slug}-${R.a}-a-${R.b}.csv`,[['Reserva','Creada','Estado','Asesor','Pasajeros','Trayectos','Vuelos','Tarifas','Pago','Total US$','Comisión US$'],
    ...rows.map(r=>[r.pnr,r.day,ST[r.st]||r.st,r.by,r.pax,r.pax*r.legs.length,r.legs.map(l=>`${l.r} ${l.d}`).join(' / '),r.legs.map(l=>FARE[l.f]||l.f).join(' / '),PM[r.pay]||r.pay||'',r.total,r.st==='confirmed'?r.com:0])]);
}
// últimos 12 meses en píldoras; se puede ver en tabla
function hoMonthly(){
  const box=$('#hoM'); if(!box) return;
  const today=dayKey(Date.now()), [Y,M]=today.split('-').map(Number), ms=[];
  for(let i=11;i>=0;i--) ms.push(isoU(new Date(Date.UTC(Y,M-1-i,1))).slice(0,7));
  const A=Object.fromEntries(ms.map(m=>[m,{n:0,sales:0,com:0,segs:0}]));
  for(const r of HO.rows){if(r.st!=='confirmed')continue;const a=A[r.day.slice(0,7)];if(a){a.n++;a.sales+=r.total;a.com+=r.com;a.segs+=r.pax*r.legs.length}}
  const v=m=>A[m][HO_M], max=Math.max(1,...ms.map(v)), fmt=HO_M==='segs'?'int':'usd', cur=today.slice(0,7), any=ms.some(m=>A[m].n);
  const short=m=>monL(m,{month:'short'}).replace('.',''), long=m=>capFirst(monL(m,{month:'long',year:'numeric'}));
  box.innerHTML=`<div class="hd ho-nh"><div><h2>Últimos 12 meses</h2><p class="muted">${HO_M==='sales'?'Ventas':HO_M==='com'?'Tu comisión':'Pasajeros emitidos por trayecto'} por mes en que se creó la reserva</p></div>
    <div class="seg" role="group" aria-label="Qué mostrar">${HO_MET.map(([k,t])=>`<button type="button" data-hm="${k}" aria-pressed="${k===HO_M}">${t}</button>`).join('')}</div></div>
   ${any?fxPills(ms.map(m=>({label:short(m),p:v(m)/max,txt:fxFmt(v(m),fmt),on:m===cur,aria:`${long(m)}: ${fxFmt(v(m),fmt)}`,tip:`<b>${long(m)}</b>${m===cur?' · en curso':''}<br>${A[m].n} ${A[m].n===1?'reserva':'reservas'} · ${A[m].segs} pasajeros<br>Ventas ${money(A[m].sales)}<br>Comisión ${money(A[m].com)}`})),{H:150})
     +`<details class="ho-det"><summary>Ver en tabla</summary><div class="tw"><table class="tbl"><thead><tr><th>Mes</th><th>Reservas</th><th>Pasajeros</th><th>Ventas</th><th>Comisión</th></tr></thead><tbody>${ms.slice().reverse().map(m=>`<tr><td>${long(m)}</td><td>${A[m].n}</td><td>${A[m].segs}</td><td>${money(A[m].sales)}</td><td>${money(A[m].com)}</td></tr>`).join('')}</tbody></table></div></details>`
     :'<p class="muted ho-empty">Cuando emitas tus primeras reservas, aquí verás tus ventas mes a mes.</p>'}`;
  $$('[data-hm]',box).forEach(b=>b.onclick=()=>{HO_M=b.dataset.hm;hoMonthly()});
}
// vuelos de los próximos 60 días donde viajan pasajeros de la agencia
function hoUpcoming(){
  const box=$('#hoU'); if(!box) return;
  const today=dayKey(Date.now()), lim=addDays(today,60), F={};
  for(const r of HO.rows){if(r.st!=='confirmed'&&r.st!=='pending')continue;
    for(const l of r.legs){if(l.d<today||l.d>lim)continue;const k=l.r+'|'+l.d;F[k]=F[k]||{k,r:l.r,d:l.d,no:l.no,dep:l.dep,pax:0,held:0,b:0};F[k][r.st==='confirmed'?'pax':'held']+=r.pax;F[k].b++}}
  const L=Object.values(F).sort((a,b)=>(a.d+(a.dep||'')).localeCompare(b.d+(b.dep||''))), more=L.length>8;
  box.innerHTML=`<h2>Próximas salidas con tus pasajeros${L.length?` <small>${L.length} ${L.length===1?'vuelo':'vuelos'} en los próximos 60 días</small>`:''}</h2>`+(L.length?`<ul class="ho-ul">${L.slice(0,8).map(f=>{const dd=Math.round((Date.parse(f.d)-Date.parse(today))/864e5);
      return `<li><span class="ho-uw"><b>${capFirst(fmtD(f.d,{weekday:'short',day:'numeric',month:'short'}))}</b><small>${dd===0?'hoy':dd===1?'mañana':`en ${dd} días`}</small></span><span class="ho-uf"><b>${f.r.replace('-',' → ')}</b><small>${esc(f.no||'')}${f.dep?` · sale ${f.dep}`:''}</small></span><span class="ho-uc"><span><b>${f.pax}</b> ${f.pax===1?'emitido':'emitidos'}</span>${f.held?`<span class="st pending">${f.held} ${f.held===1?'apartado':'apartados'} sin pago</span>`:''}</span><button type="button" class="btn ghost sm" data-man="${f.k}">Ver manifiesto</button></li>`}).join('')}</ul>${more?'<p class="fine">Se muestran los 8 vuelos más cercanos.</p>':''}`
    :`<p class="muted">Ninguno de tus pasajeros vuela en los próximos 60 días.</p><p class="ho-cta1"><a class="btn lime sm" href="#nueva">Crear una reserva</a></p>`);
  $$('[data-man]',box).forEach(b=>b.onclick=()=>{AGF=b.dataset.man;location.hash='#vuelos'});
}
const agentTabs=[['inicio','Inicio'],['nueva','Nueva reserva'],['vuelos','Vuelos'],['reservas','Mis reservas'],['cuenta','Estado de cuenta'],['club','BEE CLUB'],['material','Material'],['soporte','Soporte']];

/* ---------- FX: indicadores animados (medidor, píldoras, anillo, conteo) ---------- */
const RM=matchMedia('(prefers-reduced-motion: reduce)').matches;
const fxFmt=(v,f)=>f==='usdm'?usdM(v):f==='money'?money(v):f==='usd'?usd0(v):f==='pct'?Math.round(v)+' %':Math.round(v).toLocaleString('es-CO');
function fxCount(v,f='int'){v=+v||0;return `<b class="fx-n fx-wait" data-n="${v}" data-f="${f}">${fxFmt(RM?v:0,f)}</b>`}
const fxPolar=(r,a)=>{const t=a*Math.PI/180;return [(100+r*Math.cos(t)).toFixed(2),(100+r*Math.sin(t)).toFixed(2)]};
// medidor tipo termostato: arco de 270°, marcas, perilla y meta opcional
function fxGauge({p,val,label,sub,mark,markLabel,small}){
  p=Math.max(0,Math.min(1,+p||0));const A0=135,SW=270,R=76;
  const [x0,y0]=fxPolar(R,A0),[x1,y1]=fxPolar(R,A0+SW),arc=`M${x0} ${y0}A${R} ${R} 0 1 1 ${x1} ${y1}`;
  let t='';const N=40;for(let i=0;i<=N;i++){const a=A0+SW*i/N,[a1,b1]=fxPolar(97,a),[a2,b2]=fxPolar(i%5===0?89:92,a);t+=`<line x1="${a1}" y1="${b1}" x2="${a2}" y2="${b2}" class="fx-t${p>0&&i/N<=p+.001?' on':''}" style="--i:${i}"/>`}
  let mk='';if(mark!=null){const a=A0+SW*mark,[m1,n1]=fxPolar(62,a),[m2,n2]=fxPolar(86,a);mk=`<line x1="${m1}" y1="${n1}" x2="${m2}" y2="${n2}" class="fx-mk"/>`}
  const [kx,ky]=fxPolar(R,A0);
  return `<div class="fx-gw${small?' sm':''}"><figure class="fx-g fx-wait${small?' sm':''}"><svg viewBox="0 0 200 200" aria-hidden="true"><defs><linearGradient id="fxgr" x1="0" y1="1" x2="1" y2="0"><stop offset="0" class="fx-s0"/><stop offset="1" class="fx-s1"/></linearGradient></defs>
   ${t}<path d="${arc}" class="fx-tr" pathLength="100"/><path d="${arc}" class="fx-pr" pathLength="100" style="--o:${(100-p*100).toFixed(2)}"/>${mk}
   <g class="fx-kn" style="--r:${(p*SW).toFixed(1)}deg"><circle cx="${kx}" cy="${ky}" r="12" class="fx-kb"/><circle cx="${kx}" cy="${ky}" r="4.5" class="fx-kd"/></g></svg>
   <figcaption class="fx-gc">${val}<span>${label}</span></figcaption></figure>${sub||markLabel?`<p class="fx-gs">${sub||''}${mark!=null&&markLabel?`<span class="fx-ml"><i></i>${markLabel}</span>`:''}</p>`:''}</div>`}
// columnas en píldora (como «Próximas operaciones»)
function fxPills(items,{H=170,refs=[]}={}){
  if(!items.length) return '<p class="muted">Sin datos todavía.</p>';
  return `<div class="fx-pills fx-wait">${refs.map(r=>`<div class="fx-ref${r.crit?' crit':''}" style="bottom:${28+r.v*H}px"><span>${r.label}</span></div>`).join('')}
   ${items.map((it,i)=>{const p=Math.max(0,Math.min(1,it.p||0)),h=p>0?Math.max(40,p*H):0,hh=it.held?Math.min(H,h+it.held*H):0;
    return `<div class="fx-pill${it.on?' on':''}" tabindex="0" ${it.tip?`data-tip="${esc(it.tip)}"`:''} aria-label="${esc(it.aria||it.label)}" style="--d:${i*55}ms"><span class="fx-pt" style="height:${H}px">${hh?`<span class="fx-ph" style="height:${hh}px"></span>`:''}<span class="fx-pf" style="height:${h}px">${h>=64&&it.txt?`<em>${it.txt}</em>`:''}</span></span><span class="fx-px">${it.label}</span></div>`}).join('')}</div>`}
// anillo por segmentos con leyenda
function fxDonut(segs,center,label){
  const tot=segs.reduce((s,x)=>s+(x.v||0),0),live=segs.filter(s=>s.v>0).length,gap=live>1?1.4:0;let acc=0;
  const arcs=tot?segs.map((s,i)=>{if(!s.v)return'';const len=Math.max(.4,s.v/tot*100-gap),o=acc;acc+=s.v/tot*100;
    return `<circle cx="80" cy="80" r="64" pathLength="100" class="fx-ds ${s.cls}" style="--a:${len.toFixed(2)};--o:${(-o).toFixed(2)};--d:${i*140}ms"/>`}).join(''):'';
  return `<div class="fx-dn fx-wait"><div class="fx-dr"><svg viewBox="0 0 160 160" aria-hidden="true"><circle cx="80" cy="80" r="64" class="fx-dt"/>${arcs}</svg><div class="fx-dc">${center}<span>${label}</span></div></div>
   <ul class="fx-lg">${segs.map(s=>`<li><i class="${s.cls}"></i><span>${s.label}</span><b>${s.txt??s.v}</b></li>`).join('')}</ul></div>`}
// anillo pequeño para tablas
function fxMini(p,txt){p=Math.max(0,Math.min(1,+p||0));return `<span class="fx-mini fx-wait"><svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="14" class="fx-mt"/><circle cx="18" cy="18" r="14" pathLength="100" class="fx-mp" style="--o:${(100-p*100).toFixed(2)}"/></svg><span>${txt}</span></span>`}
// barras horizontales animadas
function fxBars(rows,fmt='money'){const max=Math.max(...rows.map(r=>r.v),1);return `<ul class="fx-bars fx-wait">${rows.map((r,i)=>`<li style="--d:${i*80}ms"><span>${esc(r.n)}</span><span class="fx-bt"><i style="width:${r.v/max*100}%"></i></span><b>${fxFmt(r.v,fmt)}</b></li>`).join('')}</ul>`}
function fxRun(el){el.classList.remove('fx-wait');const run=n=>{if(n.dataset.done)return;n.dataset.done=1;const to=+n.dataset.n,f=n.dataset.f;if(RM||!to){n.textContent=fxFmt(to,f);return}
  const t0=performance.now(),D=1100,step=t=>{const k=Math.min(1,(t-t0)/D),e=1-Math.pow(1-k,3);n.textContent=fxFmt(to*e,f);if(k<1)requestAnimationFrame(step)};requestAnimationFrame(step)};
  if(el.matches('.fx-n'))run(el);$$('.fx-n',el).forEach(n=>{n.classList.remove('fx-wait');run(n)})}
// se anima al entrar en pantalla y se vuelve a animar cada vez que sale y regresa con el scroll
const fxIO=!RM&&'IntersectionObserver' in window?new IntersectionObserver(es=>es.forEach(e=>{const el=e.target;
  if(e.isIntersecting){if(el.dataset.fxs==='out'){el.classList.add('fx-rs');void el.getBoundingClientRect();el.classList.remove('fx-rs');el.dataset.done='';$$('.fx-n',el).forEach(n=>n.dataset.done='')}
    el.dataset.fxs='in';fxRun(el)}
  else if(el.dataset.fxs==='in'&&!e.intersectionRatio){el.dataset.fxs='out';el.classList.add('fx-rs')}}),{threshold:[0,.05]}):null;
let fxTipEl=null;
function fxScan(){$$('.fx-wait,.bar,.blist').forEach(el=>{if(el.dataset.fxo||el.closest('#dash')&&!el.matches('.bar,.blist'))return;if(el.parentElement&&el.parentElement.closest('.fx-wait'))return;el.dataset.fxo=1;if(el.matches('.bar,.blist'))el.classList.add('fx-wait');fxIO?fxIO.observe(el):fxRun(el)});
  $$('[data-tip]:not([data-tb])').forEach(el=>{if(el.closest('#dash'))return;el.dataset.tb=1;
    if(!fxTipEl){fxTipEl=document.createElement('div');fxTipEl.className='dtip fx-tip';fxTipEl.setAttribute('role','tooltip');fxTipEl.hidden=true;document.body.appendChild(fxTipEl)}
    const show=()=>{fxTipEl.innerHTML=el.dataset.tip;fxTipEl.hidden=false;const r=el.getBoundingClientRect(),w=fxTipEl.offsetWidth;fxTipEl.style.left=Math.min(innerWidth-w-8,Math.max(8,r.left+r.width/2-w/2))+'px';fxTipEl.style.top=(r.top+scrollY-fxTipEl.offsetHeight-10)+'px'};
    const hide=()=>fxTipEl.hidden=true;el.addEventListener('pointerenter',show);el.addEventListener('focus',show);el.addEventListener('pointerleave',hide);el.addEventListener('blur',hide)})}
let fxQ=0;new MutationObserver(()=>{if(fxQ)return;fxQ=requestAnimationFrame(()=>{fxQ=0;fxScan();gScan();if(GP&&!GP.btn.isConnected)gpClose()})}).observe(document.getElementById('app')||document.body,{childList:true,subtree:true});
const dayKey=d=>new Date(d).toLocaleDateString('en-CA',{timeZone:'America/New_York'});
function lastDays(n){const out=[];for(let i=n-1;i>=0;i--){const d=new Date(Date.now()-i*864e5);out.push(dayKey(d))}return out}


/* ---------- agencia: alertas, por vencer, consignaciones, incentivo, calendario, documentos, avisos y material ---------- */
const left=t=>{const ms=new Date(t)-Date.now();if(ms<=0)return 'vencida';const h=Math.floor(ms/36e5),m=Math.floor(ms%36e5/6e4);return h>=48?`vence en ${Math.floor(h/24)} días`:h?`vence en ${h} h ${m} min`:`vence en ${m} min`};
const NOTICE_K={horario:'Cambio de horario',puerta:'Puerta de embarque',operacion:'Operación',general:'Aviso general'};
async function agentAlerts(){
  if(!me||me.role!=='agent')return; let bk=[],nt=[];
  try{[bk,nt]=await Promise.all([api('/agency/bookings'),api('/agency/notices')])}catch(e){return}
  const soon=bk.filter(b=>b.status==='pending'&&b.expires&&new Date(b.expires)-Date.now()<24*36e5), mineN=nt.filter(n=>n.mine||!n.flight);
  const m=$('#main'); if(!m||(!soon.length&&!mineN.length))return;
  const el=document.createElement('div'); el.className='agalerts';
  el.innerHTML=`${soon.length?`<a href="#reservas" class="aga aga-w"><b>${soon.length}</b> ${soon.length===1?'reserva vence':'reservas vencen'} en menos de 24 horas. Contacta al cliente para que pague.</a>`:''}${mineN.length?`<a href="#vuelos" class="aga aga-i"><b>${mineN.length}</b> ${mineN.length===1?'aviso':'avisos'} de la aerolínea ${mineN.some(n=>n.mine)?'para vuelos con tus pasajeros':'vigentes'}.</a>`:''}`;
  m.prepend(el);
}
function expiringCard(list,max=0){
  const all=list.filter(b=>b.status==='pending'&&b.expires).sort((a,b)=>new Date(a.expires)-new Date(b.expires)), p=max&&all.length>max+1?all.slice(0,max):all;
  if(!p.length)return '';
  return `<section class="card exp"><h2>Pendientes de pago <small class="muted">${all.length}</small></h2><p class="muted">Si el cliente no paga antes de la hora límite, la reserva vence y las sillas se liberan.</p>
   <ul class="expl">${p.map(b=>{const ms=new Date(b.expires)-Date.now(),urg=ms<24*36e5;return `<li class="${urg?'urg':''}"><span class="u-id"><b>${b.pnr} · ${esc(b.pax.map(x=>x.first+' '+x.last).join(', '))}</b><small>${b.legs.map(l=>`${l.route.replace('-','→')} ${fmtD(l.date)}`).join(' · ')} · ${money(b.total)}</small></span><span class="exp-t"><b>${left(b.expires)}</b><small>hasta ${fmtDT(b.expires)}</small></span><span class="u-act">${b.pay_url?`<button class="btn ghost sm" data-cp="${esc(b.pay_url)}">Copiar enlace de pago</button>`:''}<button class="btn lime sm" data-col="${b.pnr}" data-tot="${b.total}">Registrar pago</button><button class="btn ghost sm" data-cancel="${b.pnr}">Anular</button></span></li>`}).join('')}</ul>${all.length>p.length?`<p class="more"><button type="button" class="btn ghost sm" id="expMore">Ver las ${all.length} pendientes</button><span class="fine">Se muestran las ${p.length} que vencen primero</span></p>`:max===0&&all.length>4?`<p class="more"><button type="button" class="btn ghost sm" id="expMore">Ver menos</button></p>`:''}</section>`;
}
async function drawStatementExtras(s){
  const box=$('#stmx'); if(!box)return; let plan=null; try{plan=await api('/agency/plan')}catch(e){}
  const W=s.cash_weeks||[], over=W.filter(w=>w.overdue), next=W.find(w=>!w.overdue), M=s.months||[], mx=Math.max(1,...M.map(m=>m.commission)), cur=new Date().toLocaleDateString('en-CA',{timeZone:'America/New_York'}).slice(0,7);
  const ml=m=>{const [y,mm]=m.split('-');return new Date(+y,+mm-1,15).toLocaleDateString('es',{month:'short'})+' '+y.slice(2)};
  box.innerHTML=`<div class="fin2">
   <section class="card"><h2>Consignaciones</h2>
    ${over.length?`<p class="note err" style="display:block">Tienes ${money(over.reduce((t,w)=>t+w.amount,0))} con la fecha límite vencida. Consígnalos lo antes posible.</p>`:''}
    ${next?`<div class="nextpay"><span>Próxima consignación</span><b>${money(next.amount)}</b><small>a más tardar el ${fmtD(next.due,{weekday:'long',day:'numeric',month:'long'})}</small></div>`:'<p class="muted">No tienes efectivo pendiente por consignar.</p>'}
    ${W.length?`<div class="tw"><table class="tbl"><thead><tr><th>Semana de venta</th><th>Fecha límite</th><th>Reservas</th><th>Valor</th><th>Estado</th></tr></thead><tbody>${W.map(w=>`<tr><td>${fmtD(w.week_start,{day:'numeric',month:'short'})} – ${fmtD(w.week_end,{day:'numeric',month:'short'})}</td><td><b>${fmtD(w.due,{weekday:'short',day:'numeric',month:'short'})}</b></td><td>${w.bookings}</td><td>${money(w.amount)}</td><td><span class="st ${w.overdue?'cancelled':'pending'}">${w.overdue?'Vencida':'Por consignar'}</span></td></tr>`).join('')}</tbody></table></div>`:''}
    <p class="fine">Lo cobrado en efectivo de lunes a domingo se consigna a más tardar el martes siguiente (segundo día hábil). Cuando Beemo Air registra la consignación, la semana sale de esta lista.</p></section>
   <section class="card"><h2>Tu comisión e incentivo</h2>
    ${plan&&plan.tiers.length?`<div class="fx-grid rs"><div class="fx-cell">${fxGauge({small:1,p:plan.next?plan.segs/plan.next.min:1,val:`${fxCount(plan.segs)}${plan.next?`<i class="fx-of">/ ${plan.next.min}</i>`:''}`,label:'trayectos este mes',sub:plan.next?`Faltan ${plan.next.missing} para ${esc(plan.next.name)} (+${plan.next.incentive} %)`:'Nivel más alto alcanzado'})}</div>
     <div><p class="big2">${plan.commission+plan.incentive} %<small> de la tarifa neta</small></p><p class="muted">Comisión ${plan.commission} % + incentivo ${plan.incentive} %${plan.current?` (nivel ${esc(plan.current.name)})`:''}.</p>
     <ul class="tierl">${plan.tiers.map(t=>`<li class="${plan.current&&plan.current.min===t.min?'on':''}"><b>${esc(t.name)}</b><span>desde ${t.min} trayectos al mes</span><em>+${t.incentive} %</em></li>`).join('')}</ul></div></div>
     <p class="fine">El nivel se calcula con los trayectos emitidos (pasajeros por tramo) en el mes y se aplica a las reservas nuevas.</p>`
    :`<p class="big2">${me.agency.commission+me.agency.incentive} %<small> de la tarifa neta</small></p><p class="muted">Comisión ${me.agency.commission} %${me.agency.incentive?` más incentivo de ${me.agency.incentive} %`:''}.</p>`}
    <h3 class="fx-sub">Comisión por mes</h3>${M.length?fxPills(M.slice(-8).map(m=>({label:ml(m.month),p:m.commission/mx,txt:usd0(m.commission),on:m.month===cur,aria:`${ml(m.month)}: ${money(m.commission)}`,tip:`<b>${ml(m.month)}</b><br>${m.bookings} reservas · ${m.segs} trayectos<br>Ventas ${money(m.sales)}<br>Comisión ${money(m.commission)}`})),{H:120}):'<p class="muted">Aún no hay comisiones.</p>'}
   </section></div>`;
}
let AGM=null;
async function drawCalendar(sel){
  const box=$('#agcal'); if(!box)return;
  const now=new Date(), ym=AGM||(sel?sel.split('|')[1].slice(0,7):now.toISOString().slice(0,7)), [Y,Mo]=ym.split('-').map(Number), first=new Date(Date.UTC(Y,Mo-1,1)), days=new Date(Date.UTC(Y,Mo,0)).getUTCDate();
  const from=ym+'-01'<now.toISOString().slice(0,10)?now.toISOString().slice(0,10):ym+'-01';
  const lists=await Promise.all(ROUTES.map(([r])=>api(`/agency/flights?route=${r}&from=${from}&n=40`).catch(()=>[])));
  const by={}; lists.flat().forEach(f=>{if(f.date.slice(0,7)===ym)(by[f.date]=by[f.date]||[]).push(f)});
  const lead=(first.getUTCDay()+6)%7, cells=[]; for(let i=0;i<lead;i++)cells.push('<div class="cd0"></div>');
  for(let d=1;d<=days;d++){const k=`${ym}-${String(d).padStart(2,'0')}`,fl=by[k]||[];
    cells.push(`<div class="cdd${fl.length?' has':''}${k===now.toISOString().slice(0,10)?' today':''}"><span class="dn">${d}</span>${fl.map(f=>{const free=f.avail.eco+f.avail.biz;return `<button type="button" class="cchip ${free<20?'low':''} ${sel===f.route+'|'+f.date?'on':''}" data-agf="${f.route}|${f.date}" title="${f.no} · ${f.dep}–${f.arr} · ${free} sillas libres"><span>${f.route.replace('-','→')}</span><b>${free}</b><i style="--p:${Math.round((1-free/150)*100)}%"></i></button>`}).join('')}</div>`)}
  const label0=first.toLocaleDateString('es',{month:'long',year:'numeric',timeZone:'UTC'}),label=label0[0].toUpperCase()+label0.slice(1), prev=new Date(Date.UTC(Y,Mo-2,1)).toISOString().slice(0,7), nxt=new Date(Date.UTC(Y,Mo,1)).toISOString().slice(0,7);
  box.innerHTML=`<div class="calh"><button class="btn ghost sm" data-m="${prev}" ${prev<now.toISOString().slice(0,7)?'disabled':''} aria-label="Mes anterior">‹</button><h3>${label}</h3><button class="btn ghost sm" data-m="${nxt}" aria-label="Mes siguiente">›</button></div>
   <div class="cal"><div class="cdw">lun</div><div class="cdw">mar</div><div class="cdw">mié</div><div class="cdw">jue</div><div class="cdw">vie</div><div class="cdw">sáb</div><div class="cdw">dom</div>${cells.join('')}</div>
   <p class="fine">El número es la cantidad de sillas libres; la barra muestra cuánto del avión ya está vendido. Toca un vuelo para ver su cabina.</p>`;
  $$('[data-m]',box).forEach(b=>b.onclick=()=>{AGM=b.dataset.m;drawCalendar(sel)});
  $$('[data-agf]',box).forEach(b=>b.onclick=()=>{AGF=b.dataset.agf;viewAgentFlights().then(()=>{const c=$('.agf');c&&c.scrollIntoView({behavior:'smooth',block:'start'})})});
}
async function drawNotices(){
  const box=$('#agnot'); if(!box)return; let nt=[]; try{nt=await api('/agency/notices')}catch(e){}
  if(!nt.length){box.innerHTML='';return}
  box.innerHTML=`<section class="card"><h2>Avisos de la aerolínea</h2><ul class="notl">${nt.map(n=>`<li class="${n.mine?'mine':''}"><span class="nk">${NOTICE_K[n.kind]||'Aviso'}</span><div><b>${n.flight?`${n.flight.split('|')[0].replace('-',' → ')} · ${fmtD(n.flight.split('|')[1],{weekday:'long',day:'numeric',month:'long'})}`:'Para todos los vuelos'}</b>${n.mine?'<em>Tienes pasajeros en este vuelo</em>':''}<p>${esc(n.message)}</p><small class="muted">${fmtDT(n.created)}</small></div>${n.flight?`<button class="btn ghost sm" data-agf="${n.flight}">Ver vuelo</button>`:''}</li>`).join('')}</ul></section>`;
  $$('[data-agf]',box).forEach(b=>b.onclick=()=>{AGF=b.dataset.agf;viewAgentFlights()});
}
async function showAgentManifest(f){
  const r=await api(`/agency/manifest?route=${f.route}&date=${f.date}`),rows=r.rows,ck=r.checkin,xl={bag:'maleta',bag2:'2.ª maleta',prio:'prioritario'};
  const ckTxt=ck.state==='soon'?`El check-in abre el ${fmtDT(ck.opens)} (72 horas antes) y cierra el ${fmtDT(ck.closes)}.`:ck.state==='open'?`El check-in está abierto hasta el ${fmtDT(ck.closes)}.`:'El check-in de este vuelo ya cerró.';
  const docs=[['passport','Pasaporte','Pasaporte vigente'],['visa','Visa EE. UU.',r.to_colombia?'Visa o residencia de EE. UU. para el regreso':'Visa o residencia de EE. UU.'],['checkmig','Check-MIG','Formulario Check-MIG de Migración Colombia']];
  $('#agman').innerHTML=`<section class="card"><div class="hd"><h2>Manifiesto de tu agencia · ${f.route.replace('-',' → ')} · ${fmtD(f.date,{weekday:'long',day:'numeric',month:'long'})}</h2><button class="btn ghost sm" id="agManX">Cerrar</button></div>
   ${f.seats?miniCabin(f.seats,{mine:f.mine>0,hint:'Tus pasajeros tienen borde azul.'}):''}
   <p class="ckline ${ck.state}"><b>${ck.state==='open'?'Check-in abierto':ck.state==='soon'?'Check-in próximo':'Check-in cerrado'}</b> ${ckTxt}</p>
   ${rows.length?`<div class="tw"><table class="tbl man"><thead><tr><th>Silla</th><th>Pasajero</th><th>Tarifa</th><th>Reserva</th><th>Estado</th>${docs.map(([k,t,l])=>`<th class="dc" title="${l}">${t}</th>`).join('')}</tr></thead><tbody>${rows.map(x=>`<tr><td><b>${x.seat}</b></td><td>${esc(x.name)}${x.inf?' + bebé':''}<br><small class="muted">${esc(x.email)}${x.extras.length?' · '+x.extras.map(k=>xl[k]||k).join(', '):''}</small></td><td>${esc(x.fare)}</td><td>${x.pnr}</td><td><span class="st ${x.status}">${ST[x.status]}</span></td>${docs.map(([k])=>`<td class="dc"><label class="dchk"><input type="checkbox" data-doc="${k}" data-pnr="${x.pnr}" data-pax="${x.pax}" ${x.docs[k]?'checked':''} aria-label="${k} ${esc(x.name)}"><span></span></label></td>`).join('')}</tr>`).join('')}</tbody></table></div>
    <p class="fine">Documentos: ${docs.map(d=>d[2]).join(' · ')}.</p><p class="fine">${rows.length} ${rows.length===1?'pasajero':'pasajeros'} de tu agencia. Marca cada documento cuando lo hayas revisado con el cliente; queda guardado. Los pasajeros de otros canales no se muestran.</p>`:'<p class="muted">Tu agencia aún no tiene pasajeros en este vuelo.</p>'}</section>`;
  $('#agManX').onclick=()=>$('#agman').innerHTML='';
  $$('[data-doc]').forEach(c=>c.onchange=async()=>{try{await api('/agency/docs',{body:{pnr:c.dataset.pnr,pax:+c.dataset.pax,field:c.dataset.doc,value:c.checked}})}catch(e){c.checked=!c.checked;alert(e.message)}});
  $('#agman').scrollIntoView({behavior:'smooth',block:'start'});
}
async function viewMaterial(){
  shell(agentTabs,'material',`<section class="card"><h1>Material para vender</h1><p class="muted">Tarifas vigentes, textos listos para enviar y piezas de Beemo Air para tus clientes.</p></section>
   <section class="card"><h2>Tarifas de los próximos vuelos</h2><div id="mtf"><p class="muted">Cargando…</p></div></section>
   <section class="card"><h2>Textos para WhatsApp</h2><div id="mtw"></div></section>
   <section class="card"><h2>Piezas gráficas y documentos</h2><div id="mtp"><p class="muted">Cargando…</p></div></section>`);
  agentAlerts();
  const today=new Date().toISOString().slice(0,10);
  const lists=await Promise.all(ROUTES.map(([r])=>api(`/agency/flights?route=${r}&from=${today}&n=6`).catch(()=>[])));
  const up=lists.flat().sort((a,b)=>(a.date+a.dep).localeCompare(b.date+b.dep));
  $('#mtf').innerHTML=up.length?`<div class="tw"><table class="tbl"><thead><tr><th>Vuelo</th><th>Fecha</th>${FARE_KEYS.map(k=>`<th>${FARE[k]}</th>`).join('')}<th>Sillas libres</th></tr></thead><tbody>${up.slice(0,12).map(f=>`<tr><td><b>${f.route.replace('-',' → ')}</b><br><small class="muted">${f.no} · ${f.dep}–${f.arr}</small></td><td>${fmtD(f.date,{weekday:'short',day:'numeric',month:'short'})}</td>${FARE_KEYS.map(k=>`<td>${money(f.prices[k])}</td>`).join('')}<td>${f.avail.eco+f.avail.biz}</td></tr>`).join('')}</tbody></table></div><p class="fine">Precio por persona y por trayecto, con impuestos y tasas incluidos. Tu comisión se calcula sobre la tarifa neta.</p>`:'<p class="muted">No hay vuelos a la venta.</p>';
  const nxt=r=>up.find(f=>f.route===r), ax=nxt('MIA-AXM'), ba=nxt('MIA-BAQ'), ag=me.agency.name.replace(/\.$/,'');
  const T=[
   ['Vuelo directo Miami – Armenia',`✈️ ¡Vuelo directo Miami – Armenia con Beemo Air!\n\nSin escalas, en 3 h 35 min, y con la silla que tú escojas.\n${ax?`Próxima salida: ${fmtD(ax.date,{weekday:'long',day:'numeric',month:'long'})} a las ${ax.dep}.\n`:''}Desde ${ax?money(ax.prices.light).replace(',00',''):'US$395'} por trayecto, impuestos incluidos.\n\nReserva con nosotros en ${ag}. Escríbeme y te aparto tu silla. 🐝`],
   ['Carnaval de Barranquilla',`🎉 ¡Llega directo al Carnaval de Barranquilla!\n\nVuelo directo desde Miami${ba?` el ${fmtD(ba.date,{weekday:'long',day:'numeric',month:'long'})}`:''}, con regreso al terminar el Carnaval.\nQuien lo vive es quien lo goza. Cupos limitados.\n\nReserva en ${ag}. Escríbeme y te cuento los precios. 🐝`],
   ['Recordatorio de viaje',`Hola 👋, te escribo de ${ag} por tu vuelo con Beemo Air.\n\nAntes de viajar ten listo:\n• Pasaporte vigente\n• Visa o residencia de EE. UU. para el regreso\n• Formulario Check-MIG de Migración Colombia\n\nEl check-in abre 72 horas antes del vuelo. ¡Buen viaje! ✈️`]];
  $('#mtw').innerHTML=`<div class="wag">${T.map(([t,x],i)=>`<article class="wa"><h3>${t}</h3><pre>${esc(x)}</pre><div class="acts"><button class="btn ghost sm" data-wc="${i}">Copiar</button><a class="btn lime sm" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(x)}">Abrir en WhatsApp</a></div></article>`).join('')}</div>`;
  $$('[data-wc]').forEach(b=>b.onclick=()=>{navigator.clipboard&&navigator.clipboard.writeText(T[+b.dataset.wc][1]);b.textContent='Copiado';setTimeout(()=>b.textContent='Copiar',1500)});
  let mats=[]; try{mats=await api('/agency/materials')}catch(e){}
  const box=$('#mtp'); if(!mats.length){box.innerHTML='<p class="muted">Beemo Air todavía no ha publicado piezas. Cuando lo haga, aparecerán aquí para descargar.</p>';return}
  const img=k=>['png','jpg','jpeg','webp'].includes(k);
  box.innerHTML=`<div class="mats">${mats.map(m=>`<article class="mat">${img(m.kind)?`<div class="mth" data-th="${m.id}"></div>`:`<div class="mth doc"><span class="dk ${m.kind}">${m.kind.toUpperCase()}</span></div>`}<b>${esc(m.name)}</b><button class="btn ghost sm" data-md="${m.id}" data-n="${esc(m.name)}">Descargar</button></article>`).join('')}</div>`;
  const blob=async id=>{const r=await fetch('/api/admin/docs/'+id+'/file',{headers:{Authorization:'Bearer '+token}});if(!r.ok)throw new Error('No se pudo descargar.');return URL.createObjectURL(await r.blob())};
  $$('[data-th]').forEach(async d=>{try{d.style.backgroundImage=`url(${await blob(d.dataset.th)})`}catch(e){}});
  $$('[data-md]').forEach(b=>b.onclick=async()=>{try{const u=await blob(b.dataset.md),a=document.createElement('a');a.href=u;a.download=b.dataset.n;document.body.appendChild(a);a.click();a.remove()}catch(e){alert(e.message)}});
}

/* ---------- agencia: vuelos con cabina en miniatura y manifiesto propio ---------- */
let AGF=null;
async function viewAgentFlights(){
  shell(agentTabs,'vuelos',`<section class="card"><h1>Vuelos</h1><p class="muted">Ocupación en vivo de cada vuelo, con el mismo inventario de beemoair.com. Tus pasajeros se marcan en la cabina y en el manifiesto solo ves los de tu agencia.</p><div id="agfl"><p class="muted">Cargando…</p></div></section><div id="agman"></div><section class="card"><h2>Calendario de disponibilidad</h2><div id="agcal"><p class="muted">Cargando…</p></div></section>`);
  agentAlerts(); $('#main').insertAdjacentHTML('afterbegin','<div id="agnot"></div>'); drawNotices();
  const today=new Date().toISOString().slice(0,10);
  const lists=await Promise.all(ROUTES.map(([r])=>api(`/agency/flights?route=${r}&from=${today}&n=8`).then(x=>x.map(f=>({...f,route:r}))).catch(()=>[])));
  const up=lists.flat().sort((a,b)=>(a.date+a.dep).localeCompare(b.date+b.dep)).slice(0,8);
  const box=$('#agfl'); if(!up.length){box.innerHTML='<p class="muted">No hay vuelos programados.</p>';return}
  const cur=up.find(f=>f.route+'|'+f.date===AGF)||up[0];
  const f=await api(`/agency/flight?route=${cur.route}&date=${cur.date}`), CAP=150, occ=(f.sold+f.held)/CAP;
  const days=Math.ceil((new Date(f.dep_at)-Date.now())/864e5), hrs=Math.round((new Date(f.dep_at)-Date.now())/36e5);
  box.innerHTML=`<div class="seg fx-pick" role="group" aria-label="Elegir vuelo">${up.map(x=>`<button type="button" data-agf="${x.route}|${x.date}" aria-pressed="${x===cur}">${fmtD(x.date,{weekday:'short',day:'numeric',month:'short'})} · ${x.route.replace('-','→')}</button>`).join('')}</div>
   <article class="season agf"><div class="ss-h"><div><p class="kick">${f.route.startsWith('MIA-BAQ')||f.route.startsWith('BAQ')?'Vuelo de temporada':'Vuelo'}</p><h2>${f.route.replace('-',' → ')} · ${f.no}</h2><p class="muted">${fmtD(f.date,{weekday:'long',day:'numeric',month:'long',year:'numeric'})} · ${f.dep}–${f.arr} · ${hrs<=24?`sale en ${hrs} ${hrs===1?'hora':'horas'}`:`faltan ${days} días`}</p></div><span class="st ${f.free<20?'pending':'confirmed'}">${f.free<20?'Últimas sillas':'En venta'}</span></div>
    <div class="fx-grid ss">
     <div class="fx-cell">${fxGauge({p:occ,val:`${fxCount(f.free)}`,label:'sillas libres',sub:`${Math.round(occ*100)} % del avión ya está vendido o apartado`})}</div>
     <div class="fx-cell">${fxDonut([{v:f.mine,cls:'c1',label:'Tus pasajeros'},{v:f.sold+f.held-f.mine,cls:'c2',label:'Otros canales'},{v:f.free,cls:'c3',label:'Libres'}],fxCount(f.mine),f.mine===1?'pasajero tuyo':'pasajeros tuyos')}</div>
     </div>
    <ul class="fx-stats agf-st"><li>${fxCount(f.free-f.biz_free)}<span>libres en económica</span></li><li>${fxCount(f.biz_free)}<span>libres en Business</span></li><li>${fxCount(f.mine-f.mine_held)}<span>tus pasajeros emitidos</span></li><li>${fxCount(f.mine_held)}<span>tus apartados sin pago</span></li></ul>
    ${miniCabin(f.seats,{mine:f.mine>0,hint:'Toca «Ver manifiesto» para ver tus pasajeros.'})}
    <div class="acts"><button class="btn ghost sm" id="agManB">Ver manifiesto</button><a class="btn lime sm" href="#nueva">Reservar en este vuelo</a></div></article>`;
  $$('[data-agf]',box).forEach(b=>b.onclick=()=>{AGF=b.dataset.agf;viewAgentFlights()});
  $('#agManB').onclick=()=>showAgentManifest(f);
  drawCalendar(f.route+'|'+f.date);
}

/* ---------- soporte: chat entre agencias y Beemo Air ---------- */
const TOPIC_L={pregunta:'Pregunta',tecnico:'Soporte técnico',reservas:'Reservas',pagos:'Pagos y consignaciones'};
let SUP_T=null, SUP_ID=null, SUP_F='open';
function supStop(){if(SUP_T){clearInterval(SUP_T);SUP_T=null}}
const ago=t=>{const s=(Date.now()-new Date(t))/1e3;return s<60?'ahora':s<3600?`hace ${Math.floor(s/60)} min`:s<86400?`hace ${Math.floor(s/3600)} h`:fmtDT(t)};
function supThread(t,side){
  const mine=m=>m.side===side;
  return `<div class="sth"><div class="sth-h"><div><p class="kick">${esc(t.topic_label)} · #${t.id}${side==='beemo'?` · ${esc(t.agency)}`:''}</p><h2>${esc(t.subject)}</h2></div>
    <span class="u-act"><span class="st ${t.status==='open'?'pending':'confirmed'}">${t.status==='open'?'Abierta':'Resuelta'}</span><button class="btn ghost sm" id="supSt">${t.status==='open'?'Marcar resuelta':'Reabrir'}</button></span></div>
   <div class="msgs" id="supMsgs">${t.messages.map(m=>`<div class="msg ${mine(m)?'me':'them'}"><div class="bub">${esc(m.body).replace(/\n/g,'<br>')}</div><small>${m.side==='beemo'?'Beemo Air':esc(t.agency||me.agency?.name||'')} · ${esc(m.author_name||'')} · ${ago(m.created)}</small></div>`).join('')}</div>
   <form id="supR" class="supr"><textarea name="message" rows="2" placeholder="Escribe tu mensaje…" required></textarea><button class="btn lime">Enviar</button></form>
   <p class="fine">${t.status==='closed'?(t.mail&&t.mail.pending?'La copia de esta conversación está en cola para enviarse por correo.':t.mail&&t.mail.sent?'La copia completa de esta conversación se envió por correo a Beemo Air y a la agencia.':''):'Al marcarla como resuelta, la conversación completa se envía por correo a Beemo Air (management@beemoair.com) y a la agencia.'}</p></div>`}
async function supOpen(id,side){
  SUP_ID=id; const base=side==='beemo'?'/admin/tickets/':'/agency/tickets/'; const t=await api(base+id); const box=$('#supT'); if(!box)return;
  box.innerHTML=supThread(t,side); const ms=$('#supMsgs'); ms.scrollTop=ms.scrollHeight; supBadge();
  $$('[data-tk]').forEach(x=>x.classList.toggle('on',+x.dataset.tk===id));
  const f=$('#supR'); f.message.onkeydown=e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey))f.requestSubmit()};
  f.onsubmit=async e=>{e.preventDefault();const b=$('button',f);b.disabled=true;try{await api(base+id+'/messages',{body:{message:f.message.value}});await supOpen(id,side);supList(side)}catch(err){alert(err.message);b.disabled=false}};
  $('#supSt').onclick=async()=>{if(side==='beemo')await api(base+id+'/status',{body:{status:t.status==='open'?'closed':'open'}});else if(t.status==='open')await api(base+id+'/close',{body:{}});else return alert('Para reabrir, escribe un mensaje nuevo en la conversación.');supOpen(id,side);supList(side)};
}
async function supList(side){
  const box=$('#supL'); if(!box)return;
  const list=await api(side==='beemo'?`/admin/tickets?status=${SUP_F}`:'/agency/tickets');
  box.innerHTML=list.length?list.map(t=>`<button type="button" class="tk ${t.id===SUP_ID?'on':''}" data-tk="${t.id}"><span class="tk-h"><b>${esc(t.subject)}</b>${t.unread?`<i class="dot">${t.unread}</i>`:''}</span><small>${side==='beemo'?esc(t.agency)+' · ':''}${esc(t.topic_label)} · ${t.status==='open'?'abierta':'resuelta'} · ${ago(t.updated)}</small>${t.last?`<span class="tk-l">${t.last.side==='beemo'?'Beemo: ':''}${esc(t.last.body)}</span>`:''}</button>`).join(''):`<p class="muted">${side==='beemo'?'No hay conversaciones en esta vista.':'Aún no tienes conversaciones. Escribe tu primera consulta.'}</p>`;
  $$('[data-tk]',box).forEach(b=>b.onclick=()=>supOpen(+b.dataset.tk,side));
  return list;
}
async function viewSupport(){
  supStop(); const side=me.role==='admin'?'beemo':'agency';
  shell(side==='beemo'?adminTabs:agentTabs,'soporte',`<section class="card"><div class="hd"><div><h1>Soporte</h1><p class="muted">${side==='beemo'?'Preguntas y solicitudes de las agencias. Al cerrar un caso, la conversación completa se envía por correo a Beemo Air y a la agencia.':'Escríbele a Beemo Air: preguntas, soporte técnico, reservas o pagos. Te respondemos aquí, y al cerrar el caso te enviamos la conversación completa al correo de tu agencia.'}</p></div>
    ${side==='beemo'?`<div class="seg" role="group" aria-label="Filtro">${[['open','Abiertas'],['closed','Resueltas'],['all','Todas']].map(([k,t])=>`<button type="button" data-sf="${k}" aria-pressed="${k===SUP_F}">${t}</button>`).join('')}</div>`:'<button class="btn lime" id="supNew">Nueva consulta</button>'}</div>
    ${side==='beemo'?'<div id="mailSt"></div>':''}
    <div class="sup"><div class="supl" id="supL"><p class="muted">Cargando…</p></div><div class="supt" id="supT"><p class="muted sup-empty">Elige una conversación${side==='agency'?' o crea una nueva':''}.</p></div></div></section>`);
  if(side==='agency') agentAlerts();
  const list=await supList(side);
  if(side==='beemo'){ $$('[data-sf]').forEach(b=>b.onclick=()=>{SUP_F=b.dataset.sf;SUP_ID=null;viewSupport()});
    api('/admin/mail-status').then(m=>{const el=$('#mailSt');if(!el)return;el.innerHTML=m.configured?`<p class="mailok">Copias de casos cerrados activas desde ${esc(m.from)} · ${m.sent} enviadas${m.pending?` · ${m.pending} en cola`:''}${m.error?` · ${m.error} con error`:''}. <button class="btn ghost sm" id="mailT">Enviar correo de prueba</button></p>`:`<p class="note warn" style="display:block">El correo saliente aún no está configurado: el chat funciona, y ${m.pending} ${m.pending===1?'copia de caso cerrado queda':'copias de casos cerrados quedan'} en cola hasta conectarlo.</p>`;
      const mt=$('#mailT');if(mt)mt.onclick=async()=>{mt.disabled=true;try{await api('/admin/mail-test',{body:{}});mt.textContent='Enviado'}catch(e){alert(e.message);mt.disabled=false}}}).catch(()=>{}) }
  else { $('#supNew').onclick=()=>{SUP_ID=null;$$('[data-tk]').forEach(x=>x.classList.remove('on'));
      $('#supT').innerHTML=`<form id="supN" class="supn"><h2>Nueva consulta</h2><label>Tema<select name="topic">${Object.entries(TOPIC_L).map(([k,t])=>`<option value="${k}">${t}</option>`).join('')}</select></label><label>Asunto<input name="subject" maxlength="120" required placeholder="Ej.: No me carga el enlace de pago"></label><label>Mensaje<textarea name="message" rows="5" required placeholder="Cuéntanos qué pasa. Si es sobre una reserva, incluye el código."></textarea></label><button class="btn lime">Enviar consulta</button><p class="note" hidden></p></form>`;
      const f=$('#supN');f.onsubmit=async e=>{e.preventDefault();try{const t=await api('/agency/tickets',{body:Object.fromEntries(new FormData(f))});await supList(side);supOpen(t.id,side)}catch(err){note($('.note',f),err.message,'err')}}} }
  if(SUP_ID) supOpen(SUP_ID,side); else if(list&&list.length&&innerWidth>900) supOpen(list[0].id,side);
  SUP_T=setInterval(async()=>{if(location.hash!=='#soporte'){supStop();return}const before=SUP_ID;await supList(side);if(before&&SUP_ID===before&&!($('#supR textarea')||{}).value)supOpen(before,side)},15000);
}
// contador de no leídos en el ícono de Soporte del menú
async function supBadge(){if(me.role==='ambassador')return;try{const r=await api(me.role==='admin'?'/admin/unread':'/agency/unread');const a=$('.rail a[href="#soporte"]');if(!a)return;let d=a.querySelector('.rbadge');if(r.support){if(!d){d=document.createElement('i');d.className='rbadge';a.appendChild(d)}d.textContent=r.support}else if(d)d.remove()}catch(e){}}

/* ---------- portal del embajador ---------- */
const ambTabs=[['ventas','Mis ventas'],['enlaces','Mis enlaces']];
let AMB_M=null;
const NET_TXT={instagram:'Instagram',tiktok:'TikTok',youtube:'YouTube',facebook:'Facebook',x:'X',whatsapp:'WhatsApp'};
async function viewAmbSales(){
  shell(ambTabs,'ventas',`<section class="card"><div class="hd"><div><h1>Mis ventas</h1><p class="muted">Compras en beemoair.com hechas con tu enlace o tu código <b>${esc(me.ambassador.code)}</b>.</p></div><label class="mon">Mes<select id="abM"></select></label></div><div id="abFx"><p class="muted">Cargando…</p></div></section>
   <section class="card"><h2>Tu rango</h2><div id="abRk"></div></section>
   <section class="card"><h2>Ventas del mes</h2><div id="abT"></div></section>
   <div id="abRef"></div>`);
  const r=await api('/amb/me'+(AMB_M?`?month=${AMB_M}`:'')); AMB_M=r.month; const a=r.me, nx=a.rank.next, P=r.plan;
  const sel=$('#abM'); sel.innerHTML=r.months.map(m=>`<option value="${m}" ${m===r.month?'selected':''}>${monLabel(m)}</option>`).join(''); sel.onchange=()=>{AMB_M=sel.value;viewAmbSales()};
  const [y,mm]=r.month.split('-').map(Number), nd=new Date(y,mm,0).getDate(), dk=Array.from({length:nd},(_,i)=>`${r.month}-${String(i+1).padStart(2,'0')}`), dv=dk.map(d=>r.days[d]||0), dmx=Math.max(1,...dv), today=new Date().toLocaleDateString('en-CA',{timeZone:'America/New_York'});
  const ti=dk.indexOf(today), endI=ti>=0?ti:nd-1, dIx=innerWidth<700?Array.from({length:Math.min(15,endI+1)},(_,k)=>endI-Math.min(15,endI+1)+1+k):dk.map((_,i)=>i);
  const by=Object.entries(a.month.by).sort((x,z)=>z[1].bookings-x[1].bookings);
  $('#abFx').innerHTML=`<div class="fx-grid">
    <div class="fx-cell">${fxGauge({p:nx?a.month.segs/nx.min:1,val:`${fxCount(a.month.segs)}${nx?`<i class="fx-of">/ ${nx.min}</i>`:''}`,label:'trayectos del mes',sub:nx?`Te faltan ${nx.missing} para ${esc(nx.name)} (${nx.rate} %)`:'Estás en el rango más alto'})}</div>
    <div class="fx-cell">${fxDonut(by.length?by.slice(0,3).map(([k,v],i)=>({v:v.bookings,cls:'c'+(i+1),label:r.net_labels[k]||k,txt:String(v.bookings)})).concat(by.length>3?[{v:by.slice(3).reduce((t,x)=>t+x[1].bookings,0),cls:'c3',label:'Otras',txt:''}]:[]):[{v:0,cls:'c3',label:'Aún sin ventas',txt:'—'}],fxCount(a.month.bookings),a.month.bookings===1?'compra':'compras')}</div>
    <ul class="fx-stats"><li>${fxCount(a.month.sales,'money')}<span>vendido con tu código</span></li><li>${fxCount(a.pay.commission,'money')}<span>tu comisión (${a.rank.rate} %)</span></li><li>${fxCount(a.pay.bonus+a.pay.override,'money')}<span>bonos</span></li><li class="due">${fxCount(a.pay.total,'money')}<span>a cobrar este mes</span></li></ul>
    <div class="fx-cell fx-wide" style="grid-column:1/-1"><div class="fx-h"><h2>Trayectos por día</h2><p class="fine">${monLabel(r.month)}${dIx.length<nd?' · últimos 15 días':''}.</p></div>${fxPills(dIx.map(i=>[dv[i],i]).map(([n,i])=>({label:(innerWidth<700||i===0||(i+1)%5===0)?String(i+1):'',p:n/dmx,txt:n?String(n):'',on:dk[i]===today,aria:`${fmtD(dk[i])}: ${n} trayectos`,tip:`<b>${fmtD(dk[i],{weekday:'short',day:'numeric',month:'short'})}</b><br>${n} ${n===1?'trayecto':'trayectos'}`})),{H:120})}</div></div>
   ${a.pending?`<p class="fine">Además tienes ${a.pending} ${a.pending>1?'reservas pendientes':'reserva pendiente'} de pago con tu código: cuentan cuando el cliente pague.</p>`:''}
   <p class="fine">Tu comisión es el ${a.rank.rate} % de la tarifa neta de cada trayecto pagado, sin impuestos ni tasas. Beemo Air la liquida al cierre del mes.</p>`;
  const hmx=Math.max(1,...P.tiers.map(t=>t.rate));
  $('#abRk').innerHTML=`<div class="ladder fx-wait">${P.tiers.map((t,i)=>`<div class="step r${i}${i===a.rank.i?' me':''}" style="--h:${30+70*t.rate/hmx}%;--d:${i*120}ms"><div class="bar-s"><b>${t.rate} %</b>${t.bonus?`<small>+ ${usd0(t.bonus)}</small>`:''}</div><span class="rk r${i}">${esc(t.name)}</span><small>${i===a.rank.i?'tu rango este mes':t.min?`desde ${t.min} trayectos`:'desde el primer trayecto'}</small></div>`).join('')}</div>
   <p class="fine">El rango se calcula con los trayectos pagados del mes (pasajeros × tramos) y se reinicia cada mes. Las compras cuentan hasta ${P.window_days} días después de que el cliente abrió tu enlace.</p>
   ${r.hist.length>1?`<h3 class="fx-sub">Tus últimos meses</h3>${fxBars(r.hist.map(h=>({n:monLabel(h.month),v:h.segs})))}`:''}`;
  $('#abT').innerHTML=r.sales.length?`<div class="tw"><table class="tbl"><thead><tr><th>Fecha</th><th>Vuelo</th><th>Pasajeros</th><th>Trayectos</th><th>De dónde vino</th><th>Estado</th><th>Tu comisión</th></tr></thead><tbody>${r.sales.map(x=>`<tr><td>${fmtDT(x.at)}</td><td>${x.legs.map(l=>`${l.route.replace('-','→')} · ${fmtD(l.date,{day:'numeric',month:'short'})}`).join('<br>')}</td><td>${x.pax}</td><td>${x.segs}</td><td>${esc(x.src)}</td><td><span class="st ${x.status==='confirmed'?'confirmed':'pending'}">${x.status==='confirmed'?'Pagada':'Pendiente de pago'}</span></td><td>${x.status==='confirmed'?money(x.earn):'—'}</td></tr>`).join('')}</tbody></table></div><p class="fine">Por privacidad no mostramos nombres ni datos de los pasajeros.</p>`:`<p class="muted">Todavía no hay compras con tu código en ${monLabel(r.month)}. Comparte tus enlaces desde <a href="#enlaces">Mis enlaces</a>.</p>`;
  if(a.referrals.length) $('#abRef').innerHTML=`<section class="card"><h2>Tus referidos</h2><ul class="users">${a.referrals.map(x=>`<li><span class="u-id"><b>${esc(x.name)}</b><small>${x.segs} trayectos este mes</small></span><span>${money(x.net)} tarifa neta</span></li>`).join('')}</ul><p class="fine">${a.pay.override_qualifies?`Este mes ganas ${P.override} % de la tarifa neta de tus referidos: ${money(a.pay.override)}.`:`Para cobrar el ${P.override} % de tus referidos debes vender al menos ${P.override_min} trayectos en el mes.`}</p></section>`;
}
async function viewAmbLinks(){
  shell(ambTabs,'enlaces',`<section class="card"><h1>Mis enlaces</h1><p class="muted">Usa el enlace de cada red: así sabemos de dónde viene cada compra y la ves en Mis ventas.</p><div id="alL"></div></section>
   <section class="card"><h2>Textos listos para publicar</h2><div id="alT"></div></section>`);
  const r=await api('/amb/me'), a=r.me, code=a.code, nets=Object.keys(a.socials||{}).filter(k=>NET_TXT[k]).concat(['whatsapp']);
  const cp=(t)=>`<button type="button" class="btn ghost sm" data-cp="${esc(t)}">Copiar</button>`;
  $('#alL').innerHTML=`<ul class="amlinks">${nets.map(k=>`<li><span>${NET_TXT[k]}</span><code>${refUrl(code,k)}</code>${cp(refUrl(code,k))}</li>`).join('')}<li><span>General</span><code>${refUrl(code,'')}</code>${cp(refUrl(code,''))}</li></ul>
   <div class="alcode"><span>Tu código</span><b>${esc(code)}</b>${cp(code)}<small>Si alguien compra sin tu enlace, puede escribir este código al pagar. Esas compras aparecen como «Código escrito».</small></div>`;
  const link=refUrl(code,nets[0]||''), T=[
    ['Publicación o historia',`✈️ Miami → Armenia sin escalas con Beemo Air. Directo al Eje Cafetero en 3 h 35 min, desde US$395 por trayecto con impuestos incluidos. Reserva con mi enlace: ${link} #publicidad`],
    ['Mensaje por WhatsApp',`¡Hola! Si vas para el Eje Cafetero, Beemo Air vuela directo de Miami a Armenia. Reserva aquí y queda a mi nombre: ${refUrl(code,'whatsapp')}`],
    ['Video corto (guion)',`1. «¿Miami–Armenia sin escalas? Sí existe.» 2. Muestra el vuelo y el aeropuerto El Edén. 3. «Desde US$395 por trayecto, impuestos incluidos.» 4. «El enlace está en mi perfil o usa mi código ${code}.» Recuerda marcarlo como publicidad pagada.`]];
  $('#alT').innerHTML=`<ul class="altx">${T.map(([t,x])=>`<li><b>${t}</b><p>${esc(x)}</p>${cp(x)}</li>`).join('')}</ul>
   <p class="note warn" style="display:block">Indica siempre que es publicidad pagada (por ejemplo #publicidad o #ad, o la etiqueta de colaboración pagada de la red), como lo exigen las normas de Estados Unidos y Colombia.</p>`;
  $$('[data-cp]').forEach(b=>b.onclick=()=>{navigator.clipboard&&navigator.clipboard.writeText(b.dataset.cp);b.textContent='Copiado';setTimeout(()=>b.textContent='Copiar',1500)});
}
/* ---------- equipo: administradores y accesos temporales ---------- */
async function drawTeam(){
  const box=$('#team'); if(!box) return; let r; try{r=await api('/admin/admins')}catch(e){return}
  const until=u=>u.expires?(u.expired?'venció el ':'hasta el ')+fmtD(u.expires.slice(0,10),{day:'numeric',month:'short',year:'numeric'}):'sin vencimiento';
  box.innerHTML=`<div class="hd"><div><h2>Equipo de Beemo Air</h2><p class="muted">Quién entra al portal como administrador. Para mostrar la plataforma a alguien, crea un acceso temporal de solo lectura: puede ver todo y no puede hacer cambios.</p></div></div>
   <ul class="users">${r.list.map(u=>`<li><span class="u-id"><b>${esc(u.name||u.email)}${u.id===r.me?' (tú)':''}</b><small>${esc(u.email)} · ${u.readonly?'solo lectura':'acceso completo'} · ${until(u)}${u.must_change?' · aún no ha entrado':u.last_login?' · último ingreso '+fmtDT(u.last_login):''}${u.active?'':' · revocado'}</small></span>${u.id===r.me||me.readonly?'':`<span class="u-act">${u.expires?`<button class="btn ghost sm" data-ad="extend" data-id="${u.id}">+7 días</button>`:''}<button class="btn ghost sm" data-ad="reset" data-id="${u.id}">Nueva contraseña</button>${u.active?`<button class="btn ghost sm" data-ad="revoke" data-id="${u.id}">Revocar</button>`:''}</span>`}</li>`).join('')}</ul>
   ${me.readonly?'':`<form id="tmF" class="tmf"><h3>Nuevo acceso</h3><label>Nombre<input name="name" required maxlength="80" placeholder="Ej.: Eduardo"></label><label>Correo<input name="email" type="email" required placeholder="correo@ejemplo.com"></label>
    <label>Duración<select name="days"><option value="3">3 días</option><option value="7" selected>7 días</option><option value="14">14 días</option><option value="30">30 días</option><option value="none">Sin vencimiento</option></select></label>
    <label>Permiso<select name="readonly"><option value="true" selected>Solo lectura</option><option value="false">Acceso completo</option></select></label><label>Contraseña<input name="password" type="text" autocomplete="off" minlength="10" placeholder="Opcional · mín. 10"></label>
    <button class="btn lime">Crear acceso</button><div class="note" hidden></div></form>`}`;
  const showPw=(n,who,pw)=>{n.hidden=false;n.className='note ok tmpw';n.innerHTML=`Acceso listo para <b>${esc(who)}</b>. Contraseña temporal: <code>${esc(pw)}</code> <button type="button" class="btn ghost sm" id="tmCp">Copiar</button><br><small>Se muestra solo esta vez. Al entrar en ${esc(location.host)} le pedirá crear su propia contraseña.</small>`;$('#tmCp').onclick=()=>{navigator.clipboard.writeText(pw);$('#tmCp').textContent='Copiada'}};
  const f=$('#tmF'); if(f) f.onsubmit=async e=>{e.preventDefault();const n=$('.note',f);try{const d=Object.fromEntries(new FormData(f));if(!d.password)delete d.password;const x=await api('/admin/admins',{body:d});f.reset();await drawTeam();const n2=$('#tmF .note');if(x.password)showPw(n2,x.user.name,x.password);else{n2.hidden=false;n2.className='note ok';n2.innerHTML=`Acceso listo para <b>${esc(x.user.name)}</b>: entra en ${esc(location.host)} con <b>${esc(x.user.email)}</b> y la contraseña que escribiste.`}}catch(err){note(n,err.message,'err')}};
  $$('[data-ad]',box).forEach(b=>b.onclick=async()=>{const act=b.dataset.ad,u=r.list.find(x=>x.id===+b.dataset.id);
    if(act==='revoke'&&!confirm(`¿Revocar el acceso de ${u.name||u.email}? Se cerrará su sesión de inmediato.`))return;
    try{const x=await api(`/admin/admins/${u.id}/${act}`,{body:{}});await drawTeam();if(x.password)showPw($('#tmF .note'),u.name||u.email,x.password)}catch(err){alert(err.message)}});
}
/* ---------- admin ---------- */
const adminTabs=[['tablero','Tablero'],['finanzas','Finanzas'],['vuelos','Vuelos'],['temporadas','Temporadas'],['reservas','Reservas'],['agencias','Agencias'],['embajadores','Embajadores'],['club','BEE CLUB'],['pases','Pases'],['soporte','Soporte'],['actividad','Actividad']];
async function viewFlights(){
  shell(adminTabs,'vuelos',`<section class="card"><h1>Vuelos e inventario</h1><div id="fxv"></div></section><section class="card actcard"><div id="actf"><p class="muted">Cargando…</p></div></section><section class="card"><h2>Todos los vuelos</h2><div id="ov"><p class="muted">Cargando…</p></div></section><div id="man"></div>`);
  const o=await api('/admin/overview'); const all=sessionStorage.getItem('beemo-allf')==='1'; const shown=all?o.flights:o.flights.slice(0,20);
  const CAP=150, up=o.flights.slice(0,12), avg=up.length?up.reduce((t,f)=>t+f.sold/CAP,0)/up.length:0, sm=k=>o.flights.reduce((t,f)=>t+f[k],0);
  $('#fxv').innerHTML=`<div class="fx-grid">
   <div class="fx-cell">${fxGauge({p:avg,mark:.8,markLabel:'Meta 80 %',val:fxCount(avg*100,'pct'),label:'ocupación media',sub:`próximos ${up.length} vuelos`})}</div>
   <div class="fx-cell fx-wide"><div class="fx-h"><h2>Próximos vuelos</h2><p class="fine">Sillas emitidas; lo rayado son apartadas sin pago.</p></div>
    ${fxPills(up.map((f,i)=>({label:fmtD(f.date,{day:'numeric',month:'short'}),p:f.sold/CAP,held:f.held/CAP,txt:Math.round(f.sold/CAP*100)+' %',on:i===0,aria:`${fmtD(f.date)} ${f.no}: ${f.sold} emitidas`,
      tip:`<b>${fmtD(f.date,{weekday:'short',day:'numeric',month:'short'})} · ${f.no}</b><br>${f.route.replace('-',' → ')}<br>${f.sold} emitidas · ${f.held} apartadas · ${f.free} libres`})),{refs:[{v:.8,label:'Meta 80 %'},{v:.35,label:'Equilibrio 35 %',crit:1}]})}</div>
   <ul class="fx-stats"><li>${fxCount(sm('sold'))}<span>sillas emitidas</span></li><li>${fxCount(sm('held'))}<span>apartadas sin pago</span></li><li>${fxCount(sm('free'))}<span>sillas libres</span></li><li>${fxCount(o.flights.length)}<span>vuelos programados</span></li></ul></div>`;
  drawActive(o);
  $('#ov').innerHTML=`${o.stripe?'':'<p class="warn">La pasarela Stripe aún no está conectada: las reservas con tarjeta quedan pendientes y se confirman a mano con «Marcar pagada».</p>'}
   <div class="tw"><table class="tbl"><thead><tr><th>Fecha</th><th>Vuelo</th><th>Emitidas</th><th>Apartadas</th><th>Libres</th><th>Business libres</th><th>Ocupación</th><th></th></tr></thead><tbody>${shown.map(f=>{const occ=Math.round((f.sold+f.held)/150*100);return `<tr><td>${fmtD(f.date)}</td><td>${f.no} · ${f.route.replace('-','→')}</td><td>${f.sold}</td><td>${f.held}</td><td>${f.free}</td><td>${f.biz_free}</td><td>${fxMini(occ/100,occ+' %')}</td><td class="acts"><button class="btn ghost sm" data-man="${f.route}|${f.date}">Manifiesto</button>${f.sold+f.held?`<button class="btn ghost sm" data-bk="${f.route}|${f.date}">Reservas</button>`:''}</td></tr>`}).join('')}</tbody></table></div>${o.flights.length>20?`<button class="btn ghost sm" id="allf" style="margin-top:12px">${all?'Ver solo los próximos 20':'Ver los '+o.flights.length+' vuelos'}</button>`:''}`;
  const af=$('#allf'); if(af) af.onclick=()=>{sessionStorage.setItem('beemo-allf',all?'0':'1');viewFlights()};
  $$('[data-man]').forEach(b=>b.onclick=()=>manifest(...b.dataset.man.split('|')));
  $$('[data-bk]').forEach(b=>b.onclick=()=>{BF={flight:b.dataset.bk};sessionStorage.setItem('beemo-bf',JSON.stringify(BF));location.hash='reservas'});
}
/* ---------- admin: live dashboard vs year-1 plan ---------- */
const usd0=n=>'US$'+Math.round(n||0).toLocaleString('es-CO');
const usdK=n=>{n=n||0;const a=Math.abs(n);return (n<0?'–':'')+(a>=1e6?'US$'+(a/1e6).toLocaleString('es-CO',{maximumFractionDigits:2})+' M':a>=1e3?'US$'+(a/1e3).toLocaleString('es-CO',{maximumFractionDigits:0})+' mil':'US$'+Math.round(a))};
const pct=(n,d=0)=>(n*100).toLocaleString('es-CO',{maximumFractionDigits:d})+' %';
const MES=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
const mlabel=m=>{const [y,mm]=m.split('-');return MES[+mm-1]+' '+y.slice(2)};
let DASH_T=null;
function status(kind,label){const ic={good:'✓',warning:'!',critical:'×',neutral:'·'}[kind];return `<span class="sts ${kind}"><i aria-hidden="true">${ic}</i>${label}</span>`}
function tipBind(root){const tip=$('#dtip');$$('[data-tip]',root).forEach(el=>{const show=e=>{tip.innerHTML=el.dataset.tip;tip.hidden=false;const r=el.getBoundingClientRect(),w=tip.offsetWidth;
  tip.style.left=Math.min(innerWidth-w-8,Math.max(8,r.left+r.width/2-w/2))+'px';tip.style.top=(r.top+scrollY-tip.offsetHeight-8)+'px'};
  el.addEventListener('pointerenter',show);el.addEventListener('focus',show);el.addEventListener('pointerleave',()=>tip.hidden=true);el.addEventListener('blur',()=>tip.hidden=true)})}
// stacked bars (emitted + pending) with a plan tick per category
function chartMonths(ms){const W=760,H=260,P={l:64,r:12,t:14,b:34},iw=W-P.l-P.r,ih=H-P.t-P.b;
  const max=Math.max(...ms.map(m=>Math.max(m.plan,m.emitted+m.pending)))*1.08||1, bw=iw/ms.length, y=v=>P.t+ih-v/max*ih;
  const ticks=[0,.25,.5,.75,1].map(f=>f*max);
  let g=ticks.map(t=>`<line x1="${P.l}" x2="${W-P.r}" y1="${y(t)}" y2="${y(t)}" class="grid"/><text x="${P.l-8}" y="${y(t)+4}" class="ax" text-anchor="end">${usdK(t)}</text>`).join('');
  ms.forEach((m,i)=>{const x=P.l+i*bw+bw*.2,w=bw*.6,he=m.emitted/max*ih,hp=m.pending/max*ih,ye=P.t+ih-he,yp=ye-hp-(hp?2:0);
    const tip=`<b>${mlabel(m.month)}</b><br>Emitido ${usd0(m.emitted)}<br>Pendiente ${usd0(m.pending)}<br>Plan ${usd0(m.plan)} · ${pct((m.emitted)/m.plan)} cumplido`;
    g+=`<g class="hit" tabindex="0" data-tip="${esc(tip)}"><rect x="${P.l+i*bw}" y="${P.t}" width="${bw}" height="${ih}" fill="transparent"/>
      ${he?`<path d="M${x},${P.t+ih} v${-he+Math.min(4,he)} q0,-${Math.min(4,he)} ${Math.min(4,he)},-${Math.min(4,he)} h${w-2*Math.min(4,he)} q${Math.min(4,he)},0 ${Math.min(4,he)},${Math.min(4,he)} v${he-Math.min(4,he)} z" class="s1"/>`:''}
      ${hp?`<rect x="${x}" y="${yp}" width="${w}" height="${hp}" rx="3" class="s2"/>`:''}
      <line x1="${x-4}" x2="${x+w+4}" y1="${y(m.plan)}" y2="${y(m.plan)}" class="plan"/>
      <text x="${x+w/2}" y="${H-12}" class="ax" text-anchor="middle">${mlabel(m.month)}</text></g>`});
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Ingresos por mes de vuelo frente al plan">${g}</svg>`}
// load factor per operation with reference lines
function chartOps(ops,plan){const W=760,H=240,P={l:44,r:110,t:14,b:44},iw=W-P.l-P.r,ih=H-P.t-P.b,bw=iw/Math.max(ops.length,1),y=v=>P.t+ih-v*ih;
  let g=[0,.25,.5,.75,1].map(t=>`<line x1="${P.l}" x2="${W-P.r}" y1="${y(t)}" y2="${y(t)}" class="grid"/><text x="${P.l-8}" y="${y(t)+4}" class="ax" text-anchor="end">${t*100}%</text>`).join('');
  const ref=(v,l,c)=>`<line x1="${P.l}" x2="${W-P.r}" y1="${y(v)}" y2="${y(v)}" class="${c}"/><text x="${W-P.r+6}" y="${y(v)+4}" class="ax strong">${l} ${pct(v)}</text>`;
  g+=ref(plan.load,'Meta','ref')+ref(plan.load_min,'Mínimo','ref2')+ref(plan.breakeven_load,'Equilibrio','ref3');
  ops.forEach((o,i)=>{const x=P.l+i*bw+bw*.22,w=bw*.56,h=o.load*ih,hh=Math.max(0,(o.load_held-o.load)*ih);
    const tip=`<b>${fmtD(o.date,{weekday:'short',day:'numeric',month:'short'})} · ${esc(o.label)}</b><br>Ocupación ${pct(o.load)} (${o.sold} pax emitidos${o.held?` + ${o.held} apartados`:''})<br>Ingreso ${usd0(o.revenue)} · cubre ${pct(o.coverage)} del chárter<br>${o.seats_to_breakeven?`Faltan ~${o.seats_to_breakeven} sillas para el equilibrio`:'Costo del chárter cubierto'}`;
    g+=`<g class="hit" tabindex="0" data-tip="${esc(tip)}"><rect x="${P.l+i*bw}" y="${P.t}" width="${bw}" height="${ih}" fill="transparent"/>
      ${h?`<rect x="${x}" y="${y(o.load)}" width="${w}" height="${h}" rx="3" class="s1"/>`:''}${hh?`<rect x="${x}" y="${y(o.load_held)}" width="${w}" height="${Math.max(0,hh-2)}" rx="3" class="s2"/>`:''}
      ${ops.length<=10||i%2===0?`<text x="${x+w/2}" y="${H-26}" class="ax" text-anchor="middle">${fmtD(o.date,{day:'numeric',month:'short'})}</text>`:''}${o.label.startsWith('Carnaval')?`<text x="${x+w/2}" y="${H-12}" class="ax" text-anchor="middle">Carnaval</text>`:''}</g>`});
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Ocupación de las próximas operaciones">${g}</svg>`}
function chartDaily(ds){const W=760,H=170,P={l:64,r:12,t:10,b:26},iw=W-P.l-P.r,ih=H-P.t-P.b,max=Math.max(...ds.map(d=>d.revenue))*1.1||1,bw=iw/ds.length,y=v=>P.t+ih-v/max*ih;
  let g=[0,.5,1].map(f=>`<line x1="${P.l}" x2="${W-P.r}" y1="${y(f*max)}" y2="${y(f*max)}" class="grid"/><text x="${P.l-8}" y="${y(f*max)+4}" class="ax" text-anchor="end">${usdK(f*max)}</text>`).join('');
  ds.forEach((d,i)=>{const h=d.revenue/max*ih,x=P.l+i*bw+1,w=Math.max(2,bw-3);g+=`<g class="hit" tabindex="0" data-tip="${esc(`<b>${fmtD(d.date,{weekday:'short',day:'numeric',month:'short'})}</b><br>${d.bookings} ${d.bookings===1?'reserva':'reservas'} · ${usd0(d.revenue)}`)}"><rect x="${P.l+i*bw}" y="${P.t}" width="${bw}" height="${ih}" fill="transparent"/>${h?`<rect x="${x}" y="${y(d.revenue)}" width="${w}" height="${h}" rx="2" class="s1"/>`:''}${i%5===4||i===ds.length-1?`<text x="${x+w/2}" y="${H-8}" class="ax" text-anchor="middle">${fmtD(d.date,{day:'numeric',month:'short'})}</text>`:''}</g>`});
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Ventas de los últimos 30 días">${g}</svg>`}
function barList(rows,total){const max=Math.max(...rows.map(r=>r.v),1);return `<ul class="blist">${rows.map(r=>`<li tabindex="0" data-tip="${esc(`<b>${esc(r.n)}</b><br>${usd0(r.v)}${total?` · ${pct(r.v/total,1)}`:''}`)}"><span class="bl-n">${esc(r.n)}</span><span class="bl-b"><i style="width:${r.v/max*100}%"></i></span><span class="bl-v">${usdK(r.v)}${total?` <small>${pct(r.v/total)}</small>`:''}</span></li>`).join('')}</ul>`}
let dashLib=null, dashUnmount=null, chUnmount=null;
// caja «Canales y convenios» de la pestaña Agencias (misma librería del Tablero)
async function mountChannelsBox(){
  const el=$('#chBox'); if(!el) return;
  try{const lib=await loadDashLib(); if($('#chBox')!==el) return;
    if(chUnmount){try{chUnmount()}catch(e){} chUnmount=null}
    el.innerHTML=''; chUnmount=lib.mountChannels(el,{fetchJson:p=>api(p),saveJson:(p,b)=>api(p,{method:'PUT',body:b})})}
  catch(e){dashLib=null; if($('#chBox')===el) el.innerHTML='<h2>Canales y convenios</h2><p class="note err">No pudimos cargar el simulador. Recarga la página para intentarlo de nuevo.</p>'}
}
const channelsRefresh=()=>window.dispatchEvent(new Event('beemo-channels-refresh'));
function loadDashLib(){ if(dashLib) return dashLib;
  dashLib=new Promise((ok,ko)=>{const l=document.createElement('link');l.rel='stylesheet';l.href='/dash/dashboard.css?v=10';document.head.appendChild(l);
    const sc=document.createElement('script');sc.src='/dash/dashboard.js?v=10';sc.onload=()=>window.BeemoDashboard?ok(window.BeemoDashboard):ko(new Error('bundle'));sc.onerror=ko;document.head.appendChild(sc)});
  return dashLib }
async function viewDashboard(){
  clearInterval(DASH_T);
  shell(adminTabs,'tablero',`<div id="dash"><section class="card"><p class="muted">Cargando el tablero…</p></section></div><div id="dtip" class="dtip" role="tooltip" hidden></div>`);
  try{ const lib=await loadDashLib(); const el=$('#dash'); if(!el) return; el.innerHTML=''; dashUnmount=lib.mount(el,{fetchJson:p=>api(p)}) }
  catch(e){ // fallback: the light version without React
    await drawDash(); DASH_T=setInterval(()=>{if(location.hash.slice(1)==='tablero'||!location.hash)drawDash();else clearInterval(DASH_T)},60000) }
}
async function drawDash(){
  let d; try{d=await api('/admin/dashboard')}catch(e){return}
  const k=d.kpis,P=d.plan, box=$('#dash'); if(!box) return;
  const loadState=k.ops_next30?(k.load_next30>=P.load?['good','Sobre la meta']:k.load_next30>=P.load_min?['warning','Bajo la meta']:k.load_next30>=P.breakeven_load?['warning','Sobre el equilibrio']:['critical','Bajo el equilibrio']):['neutral','Sin vuelos en 30 días'];
  const ntState=k.emitted?(k.nontariff>=P.nontariff_share?['good','En plan']:['warning','Bajo el plan']):['neutral','Sin ventas aún'];
  const resState=k.flown_ops?(k.flown_result>=0?['good','Positivo']:['critical','Negativo']):['neutral','Desde el primer vuelo'];
  const tile=(v,l,sub,st,big)=>`<li class="${big?'big':''}"><span class="tl">${l}</span><b>${v}</b><span class="ts">${sub}</span>${st?status(st[0],st[1]):''}</li>`;
  const mixRows=[['Tarifas',d.mix.fares],['Asientos',d.mix.seats],['Equipaje y prioridad',d.mix.extras],['Bebés en brazos',d.mix.infants],['Extras después de reservar',d.mix.addons]].map(([n,v])=>({n,v})).filter(r=>r.v>0);
  const mixTot=mixRows.reduce((t,r)=>t+r.v,0);
  box.innerHTML=`
  <section class="card dhead"><div><h1>Así va Beemo Air</h1><p class="muted">Ventas reales de beemoair.com y de las agencias, comparadas con el plan del año 1 (escenario medio del informe financiero). Se actualiza cada minuto.</p></div><p class="live"><i aria-hidden="true"></i>Actualizado ${new Date(d.at).toLocaleTimeString('es',{hour:'2-digit',minute:'2-digit'})}</p></section>
  <ul class="tiles">
   ${tile(usd0(k.emitted),'Ingreso emitido',`${pct(k.emitted/P.revenue,1)} del plan anual de ${usdK(P.revenue)}`,null,1)}
   ${tile(usd0(k.pending),'Por cobrar',`Reservas apartadas sin pago`,null)}
   ${tile(k.pax_legs.toLocaleString('es-CO'),'Pasajeros emitidos',`Trayectos · plan ${P.pax.toLocaleString('es-CO')} al año`,null)}
   ${tile(k.ops_next30?pct(k.load_next30):'—','Ocupación próximos 30 días',`${k.ops_next30} operaciones · con apartados ${pct(k.load_next30_held)} · meta ${pct(P.load)}`,loadState)}
   ${tile(usd0(k.flown_result),'Resultado de vuelos realizados',`${k.flown_ops} operaciones · ingreso menos chárter de ${usd0(P.charter_per_op)}`,resState)}
   ${tile(k.emitted?pct(k.nontariff,1):'—','Ingreso no tarifario',`Asientos, equipaje y extras · plan ${pct(P.nontariff_share)}`,ntState)}
   ${tile(usd0(k.pass_revenue),'Pases de temporada',`${k.passes_sold} pagados · ${k.pass_segments_left} trayectos por volar`,null)}
   ${tile(usd0(k.cash_due),'Efectivo por consignar',`Agencias · comisiones causadas ${usd0(k.commission)}`,null)}
   ${tile(usd0(k.revenue_7d),'Ventas últimos 7 días',`${k.bookings_7d} ${k.bookings_7d===1?'reserva':'reservas'} nuevas`,null)}
  </ul>
  <section class="card"><div class="ch-h"><div><h2>Ingresos por mes de vuelo frente al plan</h2><p class="muted">Lo vendido se asigna al mes en que vuela el pasajero. Comprometido para el año 1: ${usd0(k.committed_year1)} de ${usdK(P.revenue)}.</p></div>
   <ul class="legend"><li><i class="s1"></i>Emitido</li><li><i class="s2"></i>Pendiente de pago</li><li><i class="plan"></i>Plan del mes</li></ul></div>
   ${chartMonths(d.months)}
   <details class="tview"><summary>Ver como tabla</summary><table class="tbl"><thead><tr><th>Mes</th><th>Emitido</th><th>Pendiente</th><th>Plan</th><th>Cumplimiento</th></tr></thead><tbody>${d.months.map(m=>`<tr><td>${mlabel(m.month)}</td><td>${usd0(m.emitted)}</td><td>${usd0(m.pending)}</td><td>${usd0(m.plan)}</td><td>${pct(m.emitted/m.plan,1)}</td></tr>`).join('')}</tbody></table></details></section>
  <section class="card"><div class="ch-h"><div><h2>Ocupación de las próximas operaciones</h2><p class="muted">Cada operación es ida y vuelta. Equilibrio del plan: ${pct(P.breakeven_load)} con ingresos no tarifarios; solo con tiquetes, ${pct(P.breakeven_tickets_only)}.</p></div>
   <ul class="legend"><li><i class="s1"></i>Emitido</li><li><i class="s2"></i>Apartado sin pago</li></ul></div>
   ${d.upcoming.length?chartOps(d.upcoming,P):'<p class="muted">No hay operaciones próximas.</p>'}
   <details class="tview"><summary>Ver como tabla</summary><table class="tbl"><thead><tr><th>Fecha</th><th>Operación</th><th>Ocupación</th><th>Ingreso</th><th>Cubre del chárter</th><th>Sillas para el equilibrio</th></tr></thead><tbody>${d.upcoming.map(o=>`<tr><td>${fmtD(o.date)}</td><td>${esc(o.label)}</td><td>${pct(o.load)}</td><td>${usd0(o.revenue)}</td><td>${pct(o.coverage)}</td><td>${o.seats_to_breakeven}</td></tr>`).join('')}</tbody></table></details></section>
  <div class="dgrid"><section class="card"><h2>Mezcla de ingresos emitidos</h2>${mixRows.length?barList(mixRows,mixTot):'<p class="muted">Aún no hay ventas emitidas.</p>'}</section>
   <section class="card"><h2>Ventas por canal</h2>${d.channels.length?barList(d.channels.map(c=>({n:c.name,v:c.revenue})),d.channels.reduce((t,c)=>t+c.revenue,0)):'<p class="muted">Aún no hay ventas emitidas.</p>'}</section></div>
  <section class="card"><h2>Ventas de los últimos 30 días</h2><p class="muted">Reservas nuevas por día, emitidas y pendientes.</p>${chartDaily(d.daily)}</section>
  <section class="card"><h2>Hitos</h2><ol class="miles">${d.milestones.map(m=>{const past=m.date&&m.date<new Date().toISOString().slice(0,10);
     let st; if(m.kind==='flag') st=m.value>=1?['good','Logrado']:['warning','Pendiente']; else if(m.kind==='manual') st=past?['warning','Verificar']:['neutral','Próximo']; else st=m.value>=m.target?['good','Logrado']:past?['critical','No alcanzado']:['neutral','En curso'];
     const prog=m.kind!=='manual'&&m.kind!=='flag'?`<span class="bar wide"><i style="width:${Math.min(100,m.value/m.target*100)}%"></i></span>`:'';
     return `<li><span class="md">${m.date?fmtD(m.date,{day:'numeric',month:'short',year:'numeric'}):'Continuo'}</span><div><b>${esc(m.title)}</b><p class="muted">${esc(m.detail)}</p>${prog}</div>${status(st[0],st[1])}</li>`}).join('')}</ol></section>
  <section class="card"><h2>Plan del año 1</h2><p class="muted">Escenario medio del informe para el Fondo Patria Milagro (dic 2026 – nov 2027).</p>
   <ul class="kpis plan"><li><b>${usdK(P.revenue)}</b><span>ingreso total</span></li><li><b>${usdK(P.ebitda)}</b><span>EBITDA · margen ${pct(P.margin)}</span></li><li><b>${P.ops}</b><span>operaciones</span></li><li><b>${usd0(P.rev_per_op)}</b><span>ingreso por operación</span></li><li><b>${usd0(P.charter_per_op)}</b><span>chárter por operación</span></li><li><b>${usdK(P.cash_need)}</b><span>necesidad máxima de caja</span></li></ul></section>`;
  tipBind(box);
}
const SEASON_NAME={'2027-02-06':'Carnaval de Barranquilla','2027-02-10':'Carnaval de Barranquilla'};
// plano mínimo de la cabina (horizontal, nariz a la izquierda) con la ocupación
function miniCabin(rows,opts={}){
  const st={},mn=new Set();rows.forEach(r=>{st[r.seat]=r.status;if(r.mine)mn.add(r.seat)});
  const S=13,G=3,AIS=12,X0=58,Y0=30,colY=c=>Y0+'ABCDEF'.indexOf(c)*(S+G)+('DEF'.includes(c)?AIS:0);
  let x=X0;const rx={};for(let r=1;r<=ROWS;r++){if(r===BIZ+1)x+=8;if(r===EXIT[0])x+=6;rx[r]=x;x+=S+G;if(r===EXIT[1])x+=6}
  const W=x+70,H=Y0*2+6*(S+G)-G+AIS,cy=H/2,top=Y0-12,bot=H-Y0+12;
  let g=`<path class="mc-wing" d="M${rx[11]} ${top} L${rx[14]} ${top-26} L${rx[17]+S} ${top-26} L${rx[16]+S} ${top} Z M${rx[11]} ${bot} L${rx[14]} ${bot+26} L${rx[17]+S} ${bot+26} L${rx[16]+S} ${bot} Z"/>
   <path class="mc-wing" d="M${W-48} ${top+8} L${W-26} ${top-16} L${W-12} ${top-16} L${W-18} ${cy} L${W-12} ${bot+16} L${W-26} ${bot+16} L${W-48} ${bot-8} Z"/>
   <path class="mc-body" d="M${X0-14} ${top} H${W-40} Q${W-8} ${cy} ${W-40} ${bot} H${X0-14} C${X0-62} ${bot} ${X0-58} ${top} ${X0-14} ${top} Z"/>
   <path class="mc-win" d="M${X0-36} ${cy-14} q-8 14 0 28"/>`;
  let n={confirmed:0,pending:0,free:0};
  for(let r=1;r<=ROWS;r++)for(const c of COLS){if(!isSeat(r,c))continue;const id=r+c,k=st[id]==='confirmed'?'sold':st[id]==='pending'?'held':'free';n[k==='sold'?'confirmed':k==='held'?'pending':'free']++;
    const biz=r<=BIZ,w=biz?S+2:S,y=biz?colY(c)+('AC'.includes(c)?('A'===c?0:-(S+G)/2):('DF'.includes(c)?('F'===c?0:(S+G)/2):0)):colY(c);
    const my=mn.has(id);
    g+=`<rect x="${rx[r]}" y="${y}" width="${w}" height="${biz?S+2:S}" rx="3.5" class="mc-s ${k}${biz?' biz':''}${my?' mine':''}" style="--d:${r*22}ms"><title>${id} · ${my?'tu pasajero · ':''}${k==='sold'?'emitida':k==='held'?'apartada sin pago':'libre'}${biz?' · Business':''}</title></rect>`}
  [1,BIZ+1,10,EXIT[0],20,ROWS].forEach(r=>g+=`<text x="${rx[r]+S/2}" y="${Y0-2}" class="mc-n" text-anchor="middle">${r}</text>`);
  g+=`<text x="${X0-6}" y="${colY('A')+S-3}" class="mc-n" text-anchor="end">A</text><text x="${X0-6}" y="${colY('F')+S-3}" class="mc-n" text-anchor="end">F</text>`;
  return `<figure class="mcab fx-wait"><svg viewBox="-6 -24 ${W+12} ${H+48}" role="img" aria-label="Ocupación de la cabina: ${n.confirmed} emitidas, ${n.pending} apartadas, ${n.free} libres">${g}</svg>
   <figcaption><span><i class="sold"></i>Emitida</span><span><i class="held"></i>Apartada sin pago</span><span><i class="free"></i>Libre</span><span><i class="free biz"></i>Business (filas 1–3)</span>${opts.mine?'<span><i class="minek"></i>Tus pasajeros</span>':''}<span class="mc-hint">${opts.hint||'Toca «Ver manifiesto» para ver los pasajeros.'}</span></figcaption></figure>`}
function flightCard(f,season,picker='',cabin=''){
  const CAP=150, late=season&&f.days_to_deadline<0, ok=season&&f.sold>=f.min_seats, goal=season?f.min_seats:Math.round(CAP*.8);
  const soon=f.hours_to_flight<=24?`sale en ${f.hours_to_flight} ${f.hours_to_flight===1?'hora':'horas'}`:`faltan ${f.days_to_flight} días`;
  const state=season?(ok?['confirmed','Meta alcanzada']:late?['cancelled','Plazo vencido']:f.days_to_deadline<=14?['pending','En riesgo']:['pending','En venta'])
    :(f.hours_to_flight<=24?['pending','Sale hoy']:f.sold>=goal?['confirmed','Meta alcanzada']:['confirmed','En venta']);
  const gauge=season?fxGauge({p:f.sold/f.min_seats,val:`${fxCount(f.sold)}<i class="fx-of">/ ${f.min_seats}</i>`,label:'sillas para confirmar',sub:`${late?'El plazo venció el':'Plazo'} ${fmtD(f.deadline,{day:'numeric',month:'short'})}${late?'':` · faltan ${f.days_to_deadline} días`}`})
    :fxGauge({p:f.sold/CAP,mark:.8,markLabel:'Meta 80 % · 120 sillas',val:`${fxCount(f.sold)}<i class="fx-of">/ ${CAP}</i>`,label:'sillas emitidas',sub:`${Math.round(f.sold/CAP*100)} % de ocupación`});
  return `<article class="season"><div class="ss-h"><div><p class="kick">${season?esc(SEASON_NAME[f.date]||'Vuelo de temporada'):'Vuelo activo'}</p><h2>${f.route.replace('-',' → ')} · ${f.no}</h2><p class="muted">${fmtD(f.date,{weekday:'long',day:'numeric',month:'long',year:'numeric'})} · ${f.dep}–${f.arr} · ${soon}</p></div><span class="st ${state[0]}">${state[1]}</span></div>
     ${picker}
     <div class="fx-grid ss">
      <div class="fx-cell">${gauge}</div>
      <div class="fx-cell">${fxDonut([{v:f.sold,cls:'c1',label:'Emitidas'},{v:f.held,cls:'c2',label:'Apartadas sin pago'},{v:f.free,cls:'c3',label:'Libres'}],fxCount(f.sold+f.held),'de 150 sillas')}</div>
      <div class="fx-cell fx-wide"><ul class="fx-stats two"><li>${fxCount(f.revenue,'money')}<span>tarifas emitidas</span></li><li>${fxCount(Math.max(0,goal-f.sold))}<span>sillas faltan para la meta</span></li>${season?'':`<li>${fxCount(f.biz_free)}<span>libres en Business</span></li><li>${fxCount(f.held)}<span>apartadas sin pago</span></li>`}</ul>
       <h3 class="fx-sub">Ventas por canal</h3>${f.channels.length?fxBars(f.channels.map(c=>({n:c.name,v:c.sold})),'int'):'<p class="muted">Todavía no hay ventas en este vuelo.</p>'}</div></div>
     ${cabin}
     <div class="acts"><button class="btn ghost sm" data-man="${f.route}|${f.date}">Ver manifiesto</button><button class="btn ghost sm" data-bk="${f.route}|${f.date}">Ver reservas</button></div></article>`}
let ACTF=null;
async function drawActive(o){
  const box=$('#actf'); if(!box) return;
  const up=o.flights.filter(f=>new Date(f.dep_at)>Date.now()).sort((a,b)=>a.dep_at.localeCompare(b.dep_at)).slice(0,6); if(!up.length){box.innerHTML='<p class="muted">No hay vuelos próximos programados.</p>';return}
  const cur=up.find(f=>f.route+'|'+f.date===ACTF)||up[0];
  let f,seats; try{[f,seats]=await Promise.all([api(`/admin/flight?route=${cur.route}&date=${cur.date}`),api(`/admin/manifest?route=${cur.route}&date=${cur.date}`)])}catch(e){box.innerHTML=`<p class="muted">${esc(e.message)}</p>`;return}
  const picker=`<div class="seg fx-pick" role="group" aria-label="Elegir vuelo">${up.map(x=>`<button type="button" data-actf="${x.route}|${x.date}" aria-pressed="${x===cur}">${fmtD(x.date,{weekday:'short',day:'numeric',month:'short'})} · ${x.route.replace('-','→')}</button>`).join('')}</div>`;
  box.innerHTML=flightCard(f,false,picker,miniCabin(seats));
  $$('[data-actf]',box).forEach(b=>b.onclick=()=>{ACTF=b.dataset.actf;drawActive(o)});
  $$('[data-man]',box).forEach(b=>b.onclick=()=>manifest(...b.dataset.man.split('|')));
  $$('[data-bk]',box).forEach(b=>b.onclick=()=>{BF={flight:b.dataset.bk};sessionStorage.setItem('beemo-bf',JSON.stringify(BF));location.hash='reservas'});
}
async function viewSeasons(){
  shell(adminTabs,'temporadas',`<section class="card"><h1>Vuelos de temporada</h1><p class="muted">Cada vuelo de temporada se confirma si llega a 90 sillas vendidas 45 días antes de la salida; si no, se cancela sin costo.</p><div id="ss"><p class="muted">Cargando…</p></div></section><div id="man"></div>`);
  const list=await api('/admin/seasons');
  $('#ss').innerHTML=list.length?list.map(f=>flightCard(f,true)).join(''):'<p class="muted">No hay vuelos de temporada programados.</p>';
  $$('[data-man]').forEach(b=>b.onclick=()=>manifest(...b.dataset.man.split('|')));
  $$('[data-bk]').forEach(b=>b.onclick=()=>{BF={flight:b.dataset.bk};sessionStorage.setItem('beemo-bf',JSON.stringify(BF));location.hash='reservas'});
}
async function manifest(route,date){
  const rows=await api(`/admin/manifest?route=${route}&date=${date}`);const names={};rows.forEach(r=>names[r.seat]=r.name);
  $('#man').innerHTML=`<section class="card"><h2>Manifiesto ${route.replace('-',' → ')} · ${fmtD(date,{weekday:'long',day:'numeric',month:'long'})}</h2><div class="mwrap"><div class="tw"><table class="tbl"><thead><tr><th>Silla</th><th>Pasajero</th><th>Tarifa</th><th>Reserva</th><th>Canal</th><th>Estado</th></tr></thead><tbody>${rows.map(r=>`<tr><td><b>${r.seat}</b></td><td>${esc(r.name)}${r.inf?' + bebé':''}${Object.keys(r.extras).length?`<br><small class="muted">${Object.keys(r.extras).map(k=>({bag:'maleta',bag2:'2.ª maleta',prio:'prioritario'})[k]).join(', ')}</small>`:''}</td><td>${r.fare}</td><td>${r.pnr}</td><td>${esc(r.channel)}</td><td><span class="st ${r.status}">${ST[r.status]}</span></td></tr>`).join('')||'<tr><td colspan="6" class="muted">Sin pasajeros todavía.</td></tr>'}</tbody></table></div>
   <div>${seatMap({taken:new Set(rows.map(r=>r.seat)),readOnly:true,names,status:Object.fromEntries(rows.map(r=>[r.seat,r.status]))})}<p class="mleg"><span><i class="sold"></i>Emitida (pagada)</span><span><i class="held"></i>Apartada sin pago</span><span><i class="free"></i>Libre</span></p></div></div></section>`;
  $('#man').scrollIntoView({behavior:'smooth'});
}
let BF=null;
// cobros de cambios de fecha: tarjeta por confirmar y efectivo por consignar
async function drawAdminChanges(){const box=$('#chgA');if(!box)return;let L=[];try{L=await api('/admin/changes')}catch(e){return}
  if(!L.length){box.innerHTML='';return}
  box.innerHTML=`<section class="card"><h2>Cobros de cambios y mejoras</h2><div class="tw"><table class="tbl"><thead><tr><th>Reserva</th><th>Agencia</th><th>Cambio</th><th>Monto</th><th>Pago</th><th></th></tr></thead><tbody>${L.map(c=>`<tr><td><b>${c.pnr}</b><br><small class="muted">${fmtDT(c.created)}</small></td><td>${esc(c.agency||'beemoair.com')}</td><td>${c.kind==='upgrade'?`Mejora ${FARE[c.fare_from]} → ${FARE[c.fare_to]} · ${fmtD(c.from_date,{day:'numeric',month:'short'})} · ${c.pax} pax<br><small class="muted">${money(c.diff)} por pasajero</small>`:`${fmtD(c.from_date,{day:'numeric',month:'short'})} → ${fmtD(c.to_date,{day:'numeric',month:'short'})} · ${c.pax} pax<br><small class="muted">cargo ${money(c.fee)} + diferencia ${money(c.diff)} por pasajero${c.seat_diff?` + sillas ${money(c.seat_diff)}`:''}</small>`}</td><td>${money(c.amount)}</td><td>${c.pay==='cash'?'Efectivo en la agencia · por consignar':'Tarjeta · por confirmar'}</td><td>${c.status==='pending'?`<button class="btn ghost sm" data-chp="${c.id}">Pago recibido</button>`:`<button class="btn ghost sm" data-chs="${c.id}">Consignado</button>`}</td></tr>`).join('')}</tbody></table></div></section>`;
  $$('[data-chp]',box).forEach(b=>b.onclick=async()=>{await api(`/admin/changes/${b.dataset.chp}/paid`,{body:{}});drawAdminChanges()});
  $$('[data-chs]',box).forEach(b=>b.onclick=async()=>{await api(`/admin/changes/${b.dataset.chs}/settle`,{body:{}});drawAdminChanges()});
}
async function viewAdminBookings(){
  if(!BF){try{BF=JSON.parse(sessionStorage.getItem('beemo-bf')||'{}')}catch(e){BF={}}}
  setTimeout(drawAdminChanges,0);
  shell(adminTabs,'reservas',`<div id="chgA"></div><section class="card"><h1>Reservas</h1>
   <form id="bf" class="srch filt"><label>Vuelo<select name="flight"><option value="">Todos los vuelos</option></select></label>
    <label>Canal<select name="agency"><option value="">Todos los canales</option><option value="web">beemoair.com</option></select></label>
    <label>Estado<select name="status"><option value="">Todos</option>${Object.entries(ST).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label>
    <label>Buscar<input name="q" placeholder="Código, pasajero o correo"></label>
    <span class="filt-b"><button type="button" class="btn ghost" id="bfX">Limpiar</button><button type="button" class="btn ghost" id="bfCsv" title="Descarga las reservas que cumplen los filtros">Descargar CSV</button></span></form>
   <div id="bsum"></div><div id="abl"><p class="muted">Cargando…</p></div></section>`);
  const f=$('#bf'), opts=await api('/admin/booking-filters');
  f.flight.insertAdjacentHTML('beforeend',opts.flights.map(x=>`<option value="${x.route}|${x.date}">${fmtD(x.date)} · ${x.no} · ${x.route.replace('-','→')}</option>`).join(''));
  f.agency.insertAdjacentHTML('beforeend',opts.agencies.map(a=>`<option value="${a.id}">${esc(a.name)}</option>`).join(''));
  for(const k of ['flight','agency','status','q']) if(BF[k]!=null) f[k].value=BF[k];
  let tm; const go=()=>{BF=Object.fromEntries(new FormData(f));sessionStorage.setItem('beemo-bf',JSON.stringify(BF));loadBookings()};
  f.onchange=go; f.q.oninput=()=>{clearTimeout(tm);tm=setTimeout(go,300)}; f.onsubmit=e=>{e.preventDefault();go()};
  $('#bfX').onclick=()=>{f.reset();go()};
  loadBookings();
}
let BKL=[], BKN=25;   // reservas cargadas con los filtros y cuántas filas se muestran
const AMB_SRC={instagram:'Instagram',tiktok:'TikTok',youtube:'YouTube',facebook:'Facebook',x:'X',whatsapp:'WhatsApp',otro:'otra red',codigo:'código escrito'};
async function loadBookings(keepRows){
  const qs=new URLSearchParams(Object.entries(BF||{}).filter(([k,v])=>v)).toString();
  const r=await api('/admin/bookings'+(qs?'?'+qs:'')), list=r.bookings; BKL=list; if(!keepRows) BKN=25;
  const byS=k=>list.filter(b=>b.status===k).length, days=lastDays(14), perDay=days.map(d=>list.filter(b=>dayKey(b.created)===d)), mx=Math.max(1,...perDay.map(x=>x.length));
  $('#bsum').innerHTML=`<div class="fx-grid rs">
   <div class="fx-cell">${fxDonut([{v:byS('confirmed'),cls:'c1',label:'Emitidas'},{v:byS('pending'),cls:'c2',label:'Pendientes de pago'},{v:byS('cancelled')+byS('expired'),cls:'c3',label:'Anuladas o vencidas'}],fxCount(list.length),list.length===1?'reserva':'reservas')}</div>
   <div class="fx-cell fx-wide"><div class="fx-h"><h2>Reservas por día</h2><p class="fine">Últimos 14 días, según los filtros.</p></div>${fxPills(perDay.map((x,i)=>({label:fmtD(days[i],{day:'numeric'}),p:x.length/mx,txt:String(x.length),on:i===13,aria:`${fmtD(days[i])}: ${x.length} reservas`,tip:`<b>${fmtD(days[i],{weekday:'short',day:'numeric',month:'short'})}</b><br>${x.length} ${x.length===1?'reserva':'reservas'} · ${money(x.reduce((t,b)=>t+b.total,0))}`})),{H:130})}</div>
  </div>
  <ul class="kpis sm"><li>${fxCount(r.count)}<span>${r.count===1?'reserva':'reservas'} · ${r.totals.pax} pasajeros</span></li><li>${fxCount(r.totals.confirmed,'money')}<span>emitido</span></li><li>${fxCount(r.totals.pending,'money')}<span>pendiente de pago</span></li><li class="due">${fxCount(r.totals.cash_due,'money')}<span>efectivo por consignar</span></li></ul>${r.count>list.length?`<p class="fine">Se muestran las ${list.length} más recientes. Usa los filtros para acotar.</p>`:''}`;
  const csv=$('#bfCsv'); if(csv){csv.disabled=!list.length;csv.onclick=()=>csvDownload(`beemo-reservas-${new Date().toLocaleDateString('en-CA')}.csv`,[['Código','Creada (hora de Miami)','Canal','Embajador','Estado','Pago','Consignada','Total US$','Tarifa neta US$','Comisión US$','Pasajeros','Nombres','Correo','Teléfono','Vuelos'],
    ...BKL.map(b=>[b.pnr,new Date(b.created).toLocaleString('sv-SE',{timeZone:'America/New_York'}).slice(0,16),b.agency||'beemoair.com',b.amb?b.amb.code:'',ST[b.status],payTxt(b),b.pay_method==='cash'&&b.status==='confirmed'?(b.settled?'Sí':'No'):'',b.total,b.fare_net,b.commission,b.pax.length,b.pax.map(p=>p.first+' '+p.last).join(' / '),(b.contact||{}).email||'',(b.contact||{}).phone||'',b.legs.map(l=>`${l.route} ${l.date} ${l.no} ${FARE[l.fare]} ${l.seats.join(' ')}`).join(' / ')])])}
  drawBookRows();
}
function drawBookRows(){
  const box=$('#abl'); if(!box) return; const list=BKL, shown=list.slice(0,BKN);
  box.innerHTML=list.length?`<div class="tw"><table class="tbl rsp bk"><thead><tr><th>Código</th><th>Canal</th><th>Vuelo</th><th>Pasajeros</th><th>Total</th><th>Pago</th><th>Estado</th><th></th></tr></thead><tbody>${shown.map(b=>`<tr>
   <td class="c-pnr"><b>${b.pnr}</b><br><small class="muted">${fmtDT(b.created)}</small></td><td class="c-ch">${esc(b.agency||'beemoair.com')}${b.amb?`<br><small class="muted">Embajador ${esc(b.amb.code)} · ${esc(AMB_SRC[b.amb.src]||b.amb.src||'')}</small>`:''}</td><td class="c-fl">${b.legs.map(l=>`${l.route.replace('-','→')} ${fmtD(l.date)}<br><small class="muted">${l.no} · ${FARE[l.fare]} · ${l.seats.join(', ')}</small>`).join('<br>')}</td>
   <td class="c-px">${b.pax.map(p=>esc(p.first+' '+p.last)+(p.inf?' + bebé':'')).join('<br>')}<br><small class="muted">${esc(b.contact.email)}</small></td><td class="c-tot" data-l="Total">${money(b.total)}${b.due&&b.status!=='pending'?`<br><small class="muted">extras por cobrar ${money(b.due)}</small>`:''}</td>
   <td class="c-pay">${payTxt(b)}</td><td class="c-st"><span class="st ${b.status}">${ST[b.status]}</span>${b.status==='pending'&&b.expires?`<br><small class="muted">hasta ${fmtDT(b.expires)}</small>`:''}</td>
   <td class="acts c-act">${b.status==='pending'||b.due?`<button class="btn ghost sm" data-a="paid" data-p="${b.pnr}">Marcar pagada</button>`:''}${b.pay_method==='cash'&&b.status==='confirmed'&&!b.settled?`<button class="btn ghost sm" data-a="settle" data-p="${b.pnr}">Consignado</button><button class="btn ghost sm" data-a="hold" data-p="${b.pnr}">Pasar a apartada</button>`:''}${['pending','confirmed'].includes(b.status)?`<button class="btn ghost sm danger" data-a="cancel" data-p="${b.pnr}">Anular</button>`:''}</td></tr>`).join('')}</tbody></table></div>${moreRow(shown.length,list.length,'bkMore')}`:'<p class="muted">No hay reservas con esos filtros.</p>';
  const m=$('#bkMore'); if(m) m.onclick=()=>{BKN+=25;keep(drawBookRows)};
  $$('[data-a]',box).forEach(b=>b.onclick=async()=>{const t={paid:'marcar como pagada',settle:'marcar como consignada',hold:'pasar a apartada sin pago (24 horas para pagar o se libera)',cancel:'anular (las sillas se liberan)'}[b.dataset.a];
    if(!confirm(`¿Seguro que quieres ${t} la reserva ${b.dataset.p}?`))return;try{await api(`/admin/bookings/${b.dataset.p}/${b.dataset.a}`,{body:{}});const y=scrollY;await loadBookings(true);scrollTo(0,y)}catch(e){alert(e.message)}});
}
/* ---------- admin: incentivos, avisos y material para agencias ---------- */
async function drawAgencyAdminExtras(){
  const [plan,nts,mats]=await Promise.all([api('/admin/agency-plan'),api('/admin/notices'),api('/admin/docs?audience=agencias')]);
  // plan de incentivos
  const pb=$('#agPlan'); if(pb){
    const row=t=>`<tr><td><input name="name" value="${esc(t.name||'')}" placeholder="Nivel"></td><td><input name="min" type="number" min="1" value="${t.min||''}"></td><td><input name="incentive" type="number" step="0.5" min="0" max="20" value="${t.incentive??''}"></td><td><button type="button" class="btn ghost sm" data-del>Quitar</button></td></tr>`;
    pb.innerHTML=`<p class="muted">Incentivo extra que gana cada agencia según los trayectos emitidos en el mes (pasajeros por tramo). Se aplica a las reservas nuevas y se suma a su comisión. Si una agencia tiene un incentivo fijo mayor, se respeta el mayor.${plan.tiers.length?'':' Hoy no hay niveles: las agencias solo reciben su comisión y el incentivo fijo de su tarjeta.'}</p>
     <form id="apF"><div class="tw"><table class="tbl"><thead><tr><th>Nivel</th><th>Desde (trayectos al mes)</th><th>Incentivo extra %</th><th></th></tr></thead><tbody>${plan.tiers.map(row).join('')}</tbody></table></div>
     <div class="acts"><button type="button" class="btn ghost sm" id="apAdd">Agregar nivel</button><button class="btn lime sm">Guardar plan</button></div><p class="note" hidden></p></form>`;
    const f=$('#apF'),tb=$('tbody',f),bind=()=>$$('[data-del]',f).forEach(b=>b.onclick=()=>b.closest('tr').remove());bind();
    $('#apAdd').onclick=()=>{tb.insertAdjacentHTML('beforeend',row({}));bind()};
    f.onsubmit=async e=>{e.preventDefault();const tiers=$$('tbody tr',f).map(tr=>({name:$('[name=name]',tr).value,min:$('[name=min]',tr).value,incentive:$('[name=incentive]',tr).value}));
      try{await api('/admin/agency-plan',{method:'PUT',body:{tiers}});note($('.note',f),'Plan guardado. Se aplica a las reservas nuevas.','ok')}catch(err){note($('.note',f),err.message,'err')}};
  }
  // avisos
  const nb=$('#agNot'); if(nb){
    nb.innerHTML=`<p class="muted">Lo que publiques aquí lo ven todas las agencias en su portal. Si eliges un vuelo, se resalta a las agencias que tienen pasajeros en él.</p>
     <form id="ntF" class="ag-form"><label>Tipo<select name="kind"><option value="horario">Cambio de horario</option><option value="puerta">Puerta de embarque</option><option value="operacion">Operación</option><option value="general">Aviso general</option></select></label>
      <label>Ruta (opcional)<select name="route"><option value="">Todos los vuelos</option>${ROUTES.map(([k,t])=>`<option value="${k}">${t}</option>`).join('')}</select></label><label>Fecha del vuelo<input type="date" name="date"></label>
      <label class="wide2">Mensaje<input name="message" maxlength="400" placeholder="Ej.: El vuelo sale a las 10:10 por ajuste de horario del aeropuerto." required></label><div class="acts wide2"><button class="btn lime">Publicar aviso</button></div><p class="note wide2" hidden></p></form>
     ${nts.length?`<ul class="notl adm">${nts.map(n=>`<li class="${n.active?'':'off'}"><span class="nk">${NOTICE_K[n.kind]||'Aviso'}</span><div><b>${n.flight?`${n.flight.split('|')[0].replace('-',' → ')} · ${fmtD(n.flight.split('|')[1])}`:'Todos los vuelos'}</b><p>${esc(n.message)}</p><small class="muted">${fmtDT(n.created)}${n.active?'':' · oculto'}</small></div><button class="btn ghost sm" data-nt="${n.id}" data-v="${n.active?0:1}">${n.active?'Ocultar':'Publicar de nuevo'}</button></li>`).join('')}</ul>`:''}`;
    const f=$('#ntF');f.onsubmit=async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(f));if(d.route&&!d.date)return note($('.note',f),'Elige la fecha del vuelo o deja «Todos los vuelos».','err');
      try{await api('/admin/notices',{body:{kind:d.kind,message:d.message,flight:d.route?d.route+'|'+d.date:''}});drawAgencyAdminExtras()}catch(err){note($('.note',f),err.message,'err')}};
    $$('[data-nt]',nb).forEach(b=>b.onclick=async()=>{await api('/admin/notices/'+b.dataset.nt,{method:'PATCH',body:{active:b.dataset.v==='1'}});drawAgencyAdminExtras()});
  }
  // material
  const mb=$('#agMat'); if(mb){
    const kb=n=>n>1e6?(n/1e6).toLocaleString('es-CO',{maximumFractionDigits:1})+' MB':Math.round(n/1e3)+' KB';
    mb.innerHTML=`<p class="muted">Piezas gráficas, videos y documentos que las agencias pueden descargar en su pestaña Material.</p>
     ${mats.length?`<ul class="docs">${mats.map(d=>`<li><span class="dk ${d.kind}">${d.kind.toUpperCase()}</span><span class="u-id"><b>${esc(d.name)}</b><small>${kb(d.size)} · ${fmtDT(d.uploaded)}</small></span><span class="u-act"><button class="btn ghost sm danger" data-rm="${d.id}">Quitar</button></span></li>`).join('')}</ul>`:''}
     <form id="mtF" class="upf"><label class="drop"><input type="file" name="f" accept=".pdf,.png,.jpg,.jpeg,.webp,.mp4,.pptx,.docx" multiple><span>Arrastra aquí o elige imágenes, videos MP4 o PDF (máximo 60 MB cada uno)</span></label><button class="btn lime">Subir para las agencias</button><p class="note" hidden></p></form>`;
    $$('[data-rm]',mb).forEach(b=>b.onclick=async()=>{if(!confirm('¿Quitar esta pieza? Las agencias ya no la verán.'))return;await api('/admin/docs/'+b.dataset.rm,{method:'DELETE'});drawAgencyAdminExtras()});
    const f=$('#mtF'),n=$('.note',f),drop=$('.drop',f);
    f.f.onchange=()=>{$('span',drop).textContent=[...f.f.files].map(x=>x.name).join(', ')||'Elige archivos'};
    drop.ondragover=e=>{e.preventDefault();drop.classList.add('over')};drop.ondragleave=()=>drop.classList.remove('over');drop.ondrop=e=>{e.preventDefault();drop.classList.remove('over');f.f.files=e.dataTransfer.files;f.f.onchange()};
    f.onsubmit=async e=>{e.preventDefault();const files=[...f.f.files];if(!files.length)return note(n,'Elige al menos un archivo.','err');
      for(const file of files){note(n,`Subiendo ${file.name}…`,'ok');const r=await fetch('/api/admin/docs?audience=agencias',{method:'POST',headers:{Authorization:'Bearer '+token,'X-File-Name':encodeURIComponent(file.name)},body:file});const j=await r.json().catch(()=>({}));if(!r.ok)return note(n,j.error||'No pudimos subir el archivo.','err')}
      drawAgencyAdminExtras()};
  }
}

async function viewAgencies(){
  shell(adminTabs,'agencias',`<section class="card"><div class="ag-top"><div><h1>Agencias</h1><p class="muted">Simula el convenio, mira cómo vende cada canal y gestiona las agencias y quién entra al portal.</p></div><button type="button" class="btn lime" id="agNewBtn" aria-expanded="false" aria-controls="newAgBox">Nueva agencia</button></div>
    <div id="newAgBox" hidden><h3 class="ag-new">Nueva agencia</h3><form id="newAg" class="ag-form"><label>Nombre de la agencia<input name="name" required></label><label>País<select name="country" required><option value="">Elige…</option><option>Colombia</option><option>Estados Unidos</option><option>Otro</option></select></label><label>Ciudad<input name="city"></label><label>NIT / EIN<input name="tax_id"></label><label>Contacto<input name="contact"></label><label>Correo<input name="email" type="email"></label><label>Teléfono<input name="phone"></label><label>Comisión %<input name="commission" type="number" step="0.5" min="0" max="30" value="3"></label><label>Incentivo %<input name="incentive" type="number" step="0.5" min="0" max="30" value="0"></label><button class="btn lime">Crear agencia</button></form></div><p class="note" id="agN" hidden></p></section>
   <section class="card" id="chBox"><h2>Canales y convenios</h2><p class="muted">Cargando el simulador…</p></section>
   <section class="card"><h2>Resumen de agencias</h2><div id="agfx"></div></section><div id="agl" class="aglist"></div>
   <div class="fin2"><section class="card"><h2>Plan de incentivos</h2><div id="agPlan"></div></section><section class="card"><h2>Material para agencias</h2><div id="agMat"></div></section></div>
   <section class="card"><h2>Avisos a las agencias</h2><div id="agNot"></div></section>`);
  mountChannelsBox();
  drawAgencyAdminExtras();
  const nb=$('#agNewBtn'),box=$('#newAgBox'),openNew=on=>{box.hidden=!on;nb.setAttribute('aria-expanded',String(on));nb.textContent=on?'Cerrar':'Nueva agencia';nb.classList.toggle('lime',!on);nb.classList.toggle('ghost',on);if(on)$('[name=name]',box).focus()};
  nb.onclick=()=>openNew(box.hidden);
  $('#newAg').onsubmit=async e=>{e.preventDefault();const f=e.target,d=Object.fromEntries(new FormData(f));
    try{await api('/admin/agencies',{body:d});f.reset();openNew(false);note($('#agN'),`Agencia «${d.name}» creada. Agrega su primer usuario en su tarjeta, más abajo.`,'ok');await drawAgencies();channelsRefresh()}catch(err){note($('#agN'),err.message,'err')}};
  await drawAgencies();
}
// resumen y tarjetas de agencias: se redibujan solas después de cada cambio, sin recargar la pestaña ni perder el punto de lectura
async function drawAgencies(){
  const list=await api('/admin/agencies'); if(!$('#agl')) return;
  const tot=list.reduce((t,a)=>t+a.statement.sales,0);
  $('#agfx').innerHTML=`<div class="fx-grid ag2"><div class="fx-cell">${fxDonut([...list].sort((x,y)=>y.statement.sales-x.statement.sales).map((a,i)=>({v:a.statement.sales,cls:'c'+(i%3+1),label:a.name,txt:usd0(a.statement.sales)})),fxCount(tot,'usd'),'ventas de agencias')}</div>
   <ul class="fx-stats"><li>${fxCount(list.filter(a=>a.active).length)}<span>agencias activas</span></li><li>${fxCount(list.reduce((t,a)=>t+a.statement.bookings,0))}<span>reservas emitidas</span></li><li>${fxCount(list.reduce((t,a)=>t+a.statement.commission,0),'money')}<span>comisiones causadas</span></li><li>${fxCount(list.reduce((t,a)=>t+a.statement.cash_due,0),'money')}<span>efectivo por consignar</span></li></ul></div>`;
  const FLAG=c=>c==='Colombia'?'🇨🇴':c==='Estados Unidos'?'🇺🇸':'🌐';
  const DET=[['city','Ciudad'],['tax_id','NIT / EIN'],['address','Dirección'],['contact','Contacto'],['email','Correo'],['phone','Teléfono']];
  // primero las activas y, entre ellas, la que más vende
  const order=[...list].sort((x,y)=>(y.active?1:0)-(x.active?1:0)||y.statement.sales-x.statement.sales||x.name.localeCompare(y.name,'es'));
  $('#agl').innerHTML=order.length?order.map(a=>`<section class="card ag ${a.active?'':'off'}" id="ag-${a.id}">
   <header class="ag-h"><div><h2>${esc(a.name)}</h2><p class="ag-tags"><span class="ctry">${FLAG(a.country)} ${esc(a.country||'Sin país')}</span><span class="st ${a.active?'confirmed':'cancelled'}">${a.active?'Activa':'Inactiva'}</span></p></div>
    <span class="u-act"><button type="button" class="btn lime sm" data-view="${a.id}">Ver como esta agencia</button><button type="button" class="btn ghost sm" data-toggle="${a.id}" data-on="${a.active?1:0}">${a.active?'Desactivar agencia':'Activar agencia'}</button></span></header>
   <dl class="ag-dl">${DET.map(([k,t])=>`<div><dt>${t}</dt><dd>${a[k]?esc(a[k]):'<span class="muted">—</span>'}</dd></div>`).join('')}</dl>
   <div class="ag-fx">${(()=>{const st=a.statement,c=(st.cash_settled||0)+st.cash_due;return fxGauge({small:1,p:c?(st.cash_settled||0)/c:1,val:c?fxCount((st.cash_settled||0)/c*100,'pct'):'<b>Al día</b>',label:'efectivo consignado',sub:tot?`${Math.round(st.sales/tot*100)} % de las ventas de agencias`:'sin ventas todavía'})})()}
   <ul class="kpis sm ag-k"><li>${fxCount(a.statement.bookings)}<span>emitidas</span></li><li>${fxCount(a.statement.sales,'money')}<span>ventas</span></li><li>${fxCount(a.statement.commission,'money')}<span>comisión</span></li><li class="due">${fxCount(a.statement.cash_due,'money')}<span>por consignar</span></li></ul></div>
   ${(a.statement.cash_weeks||[]).length?`<div class="ag-sec"><h3>Consignaciones pendientes</h3><ul class="agw">${a.statement.cash_weeks.map(w=>`<li class="${w.overdue?'urg':''}"><span class="u-id"><b>Semana del ${fmtD(w.week_start,{day:'numeric',month:'short'})} al ${fmtD(w.week_end,{day:'numeric',month:'short'})}</b><small>${w.bookings} ${w.bookings===1?'cobro':'cobros'} en efectivo · fecha límite ${fmtD(w.due,{weekday:'short',day:'numeric',month:'short'})}${w.overdue?' · vencida':''}</small></span><b class="agw-v">${money(w.amount)}</b><button type="button" class="btn ghost sm" data-sw="${a.id}" data-wk="${w.week_start}" data-n="${w.bookings}" data-amt="${w.amount}">Registrar consignación</button></li>`).join('')}</ul><p class="note" data-wn="${a.id}" hidden></p></div>`:''}
   <div class="ag-sec"><h3>Condiciones</h3><form class="ag-cond" data-ag="${a.id}"><label>Comisión %<input name="commission" type="number" step="0.5" min="0" max="30" value="${a.commission}"></label><label>Incentivo %<input name="incentive" type="number" step="0.5" min="0" max="30" value="${a.incentive}"></label><button class="btn ghost">Guardar</button></form><p class="note" data-cn="${a.id}" hidden></p></div>
   <div class="ag-sec"><h3>Usuarios <small class="muted">${a.users.length}</small></h3><ul class="users">${a.users.map(u=>`<li><span class="u-id"><b>${esc(u.name||u.username||u.email)}</b><small>${u.username?`usuario: <b>${esc(u.username)}</b>`:''}${u.username&&u.email?' · ':''}${esc(u.email||'')}${u.must_change?' · debe cambiar la contraseña':''}${u.active?'':' · desactivado'}</small></span><span class="u-act"><button class="btn ghost sm" data-reset="${u.id}">Nueva contraseña temporal</button><button class="btn ghost sm" data-ut="${u.id}">${u.active?'Desactivar':'Activar'}</button></span></li>`).join('')||'<li class="muted empty">Esta agencia todavía no tiene usuarios. Agrega el primero con su correo: el portal te dará su contraseña temporal.</li>'}</ul>
    <form class="ag-nu" data-nu="${a.id}"><label>Nombre<input name="name"></label><label>Usuario<input name="username" autocapitalize="none" placeholder="Ej.: martha"></label><label>Correo<input name="email" type="email" placeholder="Opcional si tiene usuario"></label><button class="btn ghost">Agregar usuario</button></form><p class="note" data-un="${a.id}" hidden></p></div></section>`).join(''):'<section class="card"><p class="muted">Aún no hay agencias. Crea la primera con el botón «Nueva agencia».</p></section>';
  $$('[data-ag]').forEach(f=>f.onsubmit=async e=>{e.preventDefault();const id=f.dataset.ag;
    try{await api('/admin/agencies/'+id,{method:'PATCH',body:Object.fromEntries(new FormData(f))});await drawAgencies();channelsRefresh();note($(`[data-cn="${id}"]`),'Condiciones guardadas. Se aplican a las reservas nuevas.','ok')}catch(err){note($(`[data-cn="${id}"]`),err.message,'err')}});
  $$('[data-sw]').forEach(b=>b.onclick=async()=>{const ag=list.find(x=>String(x.id)===b.dataset.sw),id=b.dataset.sw;
    if(!confirm(`¿Registrar la consignación de ${ag?ag.name:'la agencia'} por la semana del ${fmtD(b.dataset.wk,{day:'numeric',month:'long'})}?\n\n${b.dataset.n} ${b.dataset.n==='1'?'cobro':'cobros'} en efectivo · ${money(+b.dataset.amt)}\n\nQuedan marcados como consignados. Hazlo solo cuando el dinero ya esté en la cuenta de Beemo Air.`))return;
    try{b.disabled=true;const r=await api(`/admin/agencies/${id}/settle-week`,{body:{week:b.dataset.wk}});await drawAgencies();channelsRefresh();const n=$(`[data-wn="${id}"]`)||$(`[data-cn="${id}"]`);if(n)note(n,`Consignación registrada: ${r.bookings+r.changes} ${r.bookings+r.changes===1?'cobro':'cobros'} · ${money(r.amount)}.`,'ok')}catch(err){b.disabled=false;alert(err.message)}});
  $$('[data-view]').forEach(b=>b.onclick=async()=>{const w=window.open('about:blank','_blank');try{const r=await api(`/admin/agencies/${b.dataset.view}/view`,{body:{}});const u=location.origin+'/#as='+r.token;if(w)w.location=u;else location.href=u}catch(e){if(w)w.close();alert(e.message)}});
  $$('[data-toggle]').forEach(b=>b.onclick=async()=>{await api('/admin/agencies/'+b.dataset.toggle,{method:'PATCH',body:{active:b.dataset.on!=='1'}});await drawAgencies();channelsRefresh()});
  const showPw=(id,r)=>note($(`[data-un="${id}"]`),`Usuario para entrar: ${r.username||r.email}${r.username&&r.email?` (o ${r.email})`:''} · contraseña temporal: ${r.temp_password} — compártela por un canal seguro. Se pedirá cambiarla al entrar y no se vuelve a mostrar.`,'ok');
  $$('[data-nu]').forEach(f=>f.onsubmit=async e=>{e.preventDefault();try{const r=await api(`/admin/agencies/${f.dataset.nu}/users`,{body:Object.fromEntries(new FormData(f))});await drawAgencies();showPw(f.dataset.nu,r)}catch(err){note($(`[data-un="${f.dataset.nu}"]`),err.message,'err')}});
  $$('[data-reset]').forEach(b=>b.onclick=async()=>{if(!confirm('¿Generar una nueva contraseña temporal? La actual deja de funcionar.'))return;const id=b.closest('.ag').querySelector('[data-nu]').dataset.nu;const r=await api(`/admin/users/${b.dataset.reset}/reset`,{body:{}});await drawAgencies();showPw(id,r)});
  $$('[data-ut]').forEach(b=>b.onclick=async()=>{await api(`/admin/users/${b.dataset.ut}/toggle`,{body:{}});drawAgencies()});
}
const PST={active:'Publicado',soon:'Próximamente',inactive:'Oculto'};
const RLBL={'MIA-AXM':'Miami → Armenia','AXM-MIA':'Armenia → Miami','MIA-BAQ':'Miami → Barranquilla','BAQ-MIA':'Barranquilla → Miami'};
let PEDIT=null;
async function viewPasses(){
  shell(adminTabs,'pases',`<section class="card"><div class="hd"><h1>Tipos de pase</h1><button class="btn lime" id="pNew">Crear pase</button></div>
   <p class="muted">Lo publicado aparece en beemoair.com/pase-de-temporada y en el home; lo marcado como «Próximamente» se muestra sin botón de compra; lo oculto no se ve en la web.</p>
   <div id="pfx"></div><div id="pForm"></div><h2 class="fx-sub2">Catálogo</h2><div id="pp"><p class="muted">Cargando…</p></div></section>
   <section class="card"><h2>Pases vendidos</h2><div id="pl"><p class="muted">Cargando…</p></div></section>`);
  const [prods,list]=await Promise.all([api('/admin/pass-products'),api('/admin/passes')]);
  const paid=list.filter(p=>p.status==='paid'), segT=paid.reduce((t,p)=>t+p.total,0), segU=paid.reduce((t,p)=>t+p.total-p.left,0), mxs=Math.max(1,...prods.map(p=>p.sold||0));
  $('#pfx').innerHTML=`<div class="fx-grid ss">
   <div class="fx-cell">${fxGauge({p:segT?segU/segT:0,val:fxCount(segU),label:'trayectos usados',sub:`de ${segT} vendidos en pases pagados`})}</div>
   <div class="fx-cell">${fxDonut([{v:paid.length,cls:'c1',label:'Pagados'},{v:list.filter(p=>p.status==='pending').length,cls:'c2',label:'Pendientes de pago'},{v:list.filter(p=>p.status==='expired').length,cls:'c3',label:'Vencidos'}],fxCount(list.length),list.length===1?'pase':'pases')}</div>
   <div class="fx-cell fx-wide"><div class="fx-h"><h2>Vendidos por tipo</h2><p class="fine">${fxCount(paid.reduce((t,p)=>t+p.price,0),'money')} cobrados en pases pagados</p></div>
    ${fxPills(prods.filter(p=>p.status!=='inactive').map((p,i)=>({label:p.name.replace(/^Pase\s*/,'').slice(0,12),p:(p.sold||0)/mxs,txt:String(p.sold||0),on:(p.sold||0)===mxs&&mxs>0&&p.sold>0,aria:`${p.name}: ${p.sold||0} vendidos`,tip:`<b>${esc(p.name)}</b><br>${p.sold||0} vendidos${p.price?` · ${money(p.price)}`:''}<br>${PST[p.status]}`})),{H:130})}</div></div>`;
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
  $('#pl').innerHTML=list.length?`<div class="tw"><table class="tbl"><thead><tr><th>Código</th><th>Pase</th><th>Cliente</th><th>Trayectos</th><th>Precio</th><th>Vence</th><th>Estado</th><th></th></tr></thead><tbody>${list.map(p=>`<tr><td><b>${p.code}</b><br><small class="muted">${fmtDT(p.created)}</small></td><td>${esc(p.product)}</td><td>${esc(p.name)}<br><small class="muted">${esc(p.email)}</small></td><td>${fxMini(p.total?(p.total-p.left)/p.total:0,`${p.total-p.left}/${p.total}`)}</td><td>${money(p.price)}</td><td>${fmtD(p.exp,{day:'numeric',month:'short',year:'numeric'})}</td><td><span class="st ${p.status==='paid'?'confirmed':p.status}">${{pending:'Pendiente de pago',paid:'Pagado',expired:'Vencido'}[p.status]||p.status}</span></td><td>${p.status!=='paid'?`<button class="btn ghost sm" data-pp="${p.code}">Marcar pagado</button>`:''}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">Todavía no hay pases vendidos.</p>';
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
  const f=$('#pf'), calc=()=>{const n=+f.segments.value,pr=+f.price.value;$('#pfCalc').textContent=n&&pr?`${money(pr/n)} por trayecto · el cliente ahorra US$${Math.max(0,Math.round(644.5*n-pr))} frente a ${n} tiquetes Classic de US$644,50 (con tasas).`:''};
  f.segments.oninput=f.price.oninput=calc; calc();
  $('#pfX').onclick=()=>{PEDIT=null;box.innerHTML=''};
  f.onsubmit=async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(f));d.routes=$$('[name=routes]:checked',f).map(x=>x.value);
    try{if(p.id) await api('/admin/pass-products/'+p.id,{method:'PATCH',body:d}); else await api('/admin/pass-products',{body:d}); PEDIT=null; viewPasses()}catch(err){note($('.note',f),err.message,'err')}};
  box.scrollIntoView({behavior:'smooth',block:'start'});
}
// el registro guarda frases cortas en inglés; aquí se muestran en español claro
const LOG_ST={confirmed:'emitida',pending:'apartada, pendiente de pago',cancelled:'anulada',expired:'vencida'};
const LOG_RULES=[
  [/^login$/,()=>'Inició sesión'],[/^password changed$/,()=>'Cambió su contraseña'],[/^admin created$/,()=>'Creó la cuenta de administrador'],
  [/^channel simulator saved$/,()=>'Guardó el escenario del simulador de canales y convenios'],[/^ambassador plan updated$/,()=>'Actualizó el plan de compensación de embajadores'],[/^agency plan updated$/,()=>'Actualizó el plan de incentivos de agencias'],
  [/^booking (\w+) (confirmed|pending) ([\d.]+)$/,m=>`Creó la reserva ${m[1]}: ${LOG_ST[m[2]]} · ${money(+m[3])}`],
  [/^booking (\w+) paid$/,m=>`Marcó como pagada la reserva ${m[1]}`],
  [/^booking (\w+) leg (\d) (\d{4}-\d\d-\d\d) -> (\d{4}-\d\d-\d\d) \(([\d.]+) ?(\w*)\)$/,m=>`Cambió la fecha de la reserva ${m[1]}: del ${fmtD(m[3])} al ${fmtD(m[4])}${+m[5]?` · ${money(+m[5])}${m[6]==='cash'?' en efectivo':m[6]==='card'?' con tarjeta':''}`:' · sin cargo'}`],
  [/^booking (\w+) leg (\d) (\w+) -> (\w+) \(([\d.]+)\)$/,m=>`Mejoró la tarifa de la reserva ${m[1]}: de ${FARE[m[3]]||m[3]} a ${FARE[m[4]]||m[4]} · ${money(+m[5])}`],
  [/^booking (\w+) edited ([\d.]+) -> ([\d.]+)$/,m=>`Editó la reserva ${m[1]}: el total pasó de ${money(+m[2])} a ${money(+m[3])}`],
  [/^booking (\w+) collected at agency ([\d.]+)$/,m=>`Registró el pago de la reserva ${m[1]} en la agencia · ${money(+m[2])}`],
  [/^booking (\w+) -> pending \(apartada sin pago\)$/,m=>`Pasó la reserva ${m[1]} a apartada sin pago`],
  [/^booking (\w+) -> (\w+)$/,m=>`La reserva ${m[1]} quedó ${LOG_ST[m[2]]||m[2]}`],
  [/^settled (\w+)$/,m=>`Marcó como consignada la reserva ${m[1]}`],[/^addon (\w+) (\w+)$/,m=>`Agregó un extra a la reserva ${m[1]}: ${XL[m[2]]||m[2]}`],
  [/^change (\S+) paid$/,m=>`Se pagó el cambio n.º ${m[1]}`],[/^change (\d+) (\w+)$/,m=>`Cambio n.º ${m[1]}: ${({paid:'marcado como pagado',settle:'marcado como consignado',cancel:'anulado'})[m[2]]||m[2]}`],
  [/^settled week (\S+) agency (\d+): (\d+) \w+ ([\d.]+)$/,m=>`Registró la consignación de ${logAg(m[2])} por la semana del ${fmtD(m[1])}: ${m[3]} ${m[3]==='1'?'cobro':'cobros'} · ${money(+m[4])}`],
  [/^agency (\d+) updated$/,m=>`Actualizó ${logAg(m[1])}`],[/^agency (.+)$/,m=>`Creó la agencia ${m[1]}`],
  [/^user (.+) for agency (\d+)$/,m=>`Creó el usuario ${m[1]} para ${logAg(m[2])}`],[/^reset (.+)$/,m=>`Generó una contraseña temporal para ${m[1]}`],
  [/^view as agency (.+)$/,m=>`Abrió el portal como la agencia ${m[1]}`],[/^view as ambassador (.+)$/,m=>`Abrió el portal como el embajador ${m[1]}`],
  [/^ambassador (\S+) created$/,m=>`Creó el embajador ${m[1]}`],[/^ambassador (\S+) updated$/,m=>`Actualizó el embajador ${m[1]}`],[/^ambassador (\S+) portal access$/,m=>`Dio acceso al portal al embajador ${m[1]}`],
  [/^ticket #(\d+) (closed|resolved)$/,m=>`Cerró el caso de soporte n.º ${m[1]}`],[/^ticket #(\d+) open$/,m=>`Reabrió el caso de soporte n.º ${m[1]}`],[/^ticket #(\d+) (.+)$/,m=>`Abrió el caso de soporte n.º ${m[1]}: ${m[2]}`],
  [/^notice (\S+) (.+)$/,m=>`Publicó un aviso (${NOTICE_K[m[1]]||m[1]}) para ${m[2]==='general'?'todos los vuelos':m[2].replace('|',' del ').replace('-',' → ')}`],
  [/^impact (\S+) (\d+) cupos ([\d.]+) kg$/,m=>`Registró el impacto del vuelo ${m[1].replace('|',' del ').replace('-',' → ')}: ${m[2]} cupos sociales y ${m[3]} kg de ayuda`],
  [/^providers (\d+)$/,m=>`Actualizó los prestadores locales vinculados: ${m[1]}`],
  [/^doc deleted (.+)$/,m=>`Quitó el documento ${m[1]}`],[/^doc (.+?)( \(modelo financiero\))?$/,m=>`Subió el documento ${m[1]}${m[2]?' como modelo financiero':''}`],
  [/^pass product (.+) created \((\w+)\)$/,m=>`Creó el pase ${m[1]} (${(PST[m[2]]||m[2]).toLowerCase()})`],[/^pass product (\d+) -> (\w+)$/,m=>`Cambió el pase n.º ${m[1]} a ${(PST[m[2]]||m[2]).toLowerCase()}`],[/^pass product (\d+) cloned$/,m=>`Duplicó el pase n.º ${m[1]}`],
  [/^pass (\S+) paid$/,m=>`Se pagó el pase ${m[1]}`],[/^pass (\S+) pending \((.+)\)$/,m=>`Pase ${m[1]} pendiente de pago (${m[2]})`],
  [/^PAID AFTER EXPIRY (\w+)/,m=>`Atención: llegó un pago de la reserva ${m[1]} después de vencida. Hay que revisarla y reembolsar o reubicar`],
  [/^club: (.+)$/,m=>`BEE CLUB: ${m[1]}`],[/^admin (.+)$/,m=>`Administrador ${m[1]}`],
];
let LOG_AG={}; const logAg=id=>LOG_AG[id]?`la agencia ${LOG_AG[id]}`:`la agencia n.º ${id}`;
const logText=w=>{for(const [re,f] of LOG_RULES){const m=re.exec(w);if(m){try{return f(m)}catch(e){return w}}}return w};
let LOGL=[], LOGN=40, LOGQ='', LOGIN=false;   // movimientos, filas visibles, búsqueda y si se muestran los inicios de sesión
const logWho=w=>w?String(w).replace(/@sin-correo\.invalid$/,''):'Sistema';
async function viewLog(){
  shell(adminTabs,'actividad',`<section class="card"><h1>Actividad</h1><div id="lg"></div></section><section class="card" id="team"></section>`);
  drawTeam();
  const [l,flt]=await Promise.all([api('/admin/log'),api('/admin/booking-filters').catch(()=>({agencies:[]}))]), days=lastDays(14), per=days.map(d=>l.filter(x=>dayKey(x.at)===d).length), mx=Math.max(1,...per), who=new Set(l.map(x=>x.who).filter(Boolean));
  LOG_AG=Object.fromEntries((flt.agencies||[]).map(a=>[a.id,String(a.name).replace(/\.$/,'')]));
  LOGL=l.map(x=>({...x,txt:logText(x.what||'')})); LOGN=40;
  $('#lg').innerHTML=`<div class="fx-grid rs"><ul class="fx-stats"><li>${fxCount(per[13])}<span>movimientos hoy</span></li><li>${fxCount(per.reduce((a,b)=>a+b,0))}<span>en 14 días</span></li><li>${fxCount(who.size)}<span>usuarios con actividad</span></li></ul>
   <div class="fx-cell fx-wide"><div class="fx-h"><h2>Movimientos por día</h2><p class="fine">Últimos 14 días.</p></div>${fxPills(per.map((n,i)=>({label:fmtD(days[i],{day:'numeric'}),p:n/mx,txt:String(n),on:i===13,aria:`${fmtD(days[i])}: ${n} movimientos`,tip:`<b>${fmtD(days[i],{weekday:'short',day:'numeric',month:'short'})}</b><br>${n} ${n===1?'movimiento':'movimientos'}`})),{H:130})}</div></div>
   <div class="fx-h lgh"><h2 class="fx-sub2">Últimos movimientos</h2><span class="lgf"><label class="chk"><input type="checkbox" id="lgIn" ${LOGIN?'checked':''}> Mostrar inicios de sesión</label><label class="lgq">Buscar<input id="lgQ" type="search" placeholder="Reserva, persona o acción" value="${esc(LOGQ)}" autocomplete="off"></label></span></div><div id="lgL"></div>`;
  $('#lgIn').onchange=e=>{LOGIN=e.target.checked;LOGN=40;drawLog()};
  let tm; $('#lgQ').oninput=e=>{clearTimeout(tm);const v=e.target.value;tm=setTimeout(()=>{LOGQ=v;LOGN=40;drawLog()},200)};
  drawLog();
}
function drawLog(){
  const box=$('#lgL'); if(!box) return; const t=normTxt(LOGQ), base=LOGIN?LOGL:LOGL.filter(x=>x.what!=='login'), rows=t?base.filter(x=>normTxt(x.txt+' '+x.what+' '+(x.who||'')).includes(t)):base, shown=rows.slice(0,LOGN), hid=LOGL.length-base.length;
  box.innerHTML=`<ol class="fx-tl">${shown.map((x,i)=>`<li style="--d:${Math.min(i,20)*35}ms"><i aria-hidden="true"></i><time>${fmtDT(x.at)}</time><b>${esc(logWho(x.who))}</b><span title="${esc(x.what||'')}">${esc(x.txt)}</span></li>`).join('')||`<li class="muted">${t?'Nada coincide con esa búsqueda.':hid?'Solo hay inicios de sesión; márcalos arriba para verlos.':'Sin actividad todavía.'}</li>`}</ol>${moreRow(shown.length,rows.length,'lgMore',40)}${hid&&!t?`<p class="fine">No se muestran ${hid} ${hid===1?'inicio':'inicios'} de sesión.</p>`:''}`;
  const m=$('#lgMore'); if(m) m.onclick=()=>{LOGN+=40;keep(drawLog)};
}

/* ---------- admin: embajadores (influencers) ---------- */
const NET_ICON={instagram:'IG',tiktok:'TT',youtube:'YT',facebook:'FB',x:'X',whatsapp:'WA',otro:'·',codigo:'#'};
const SOC=[['instagram','Instagram'],['tiktok','TikTok'],['youtube','YouTube'],['facebook','Facebook'],['x','X']];
let AMON=null, AEDIT=null;
const refUrl=(code,net)=>`https://beemoair.com/?ref=${encodeURIComponent(code)}${net?`&red=${net}`:''}`;
const curMonth=()=>new Date().toLocaleDateString('en-CA',{timeZone:'America/New_York'}).slice(0,7);
const monLabel=m=>{const [y,mm]=m.split('-');return new Date(+y,+mm-1,15).toLocaleDateString('es',{month:'long',year:'numeric'})};
async function viewAmbassadors(){
  shell(adminTabs,'embajadores',`<section class="card"><div class="hd"><h1>Embajadores</h1><label class="mon">Mes<select id="amMon"></select></label></div>
   <p class="muted">Influencers con código propio. Cada compra en beemoair.com con su enlace o su código les suma trayectos, y su comisión sube de rango según lo que vendan en el mes.</p>
   <div id="amFx"><p class="muted">Cargando…</p></div></section>
   <section class="card"><h2>Ranking del mes</h2><div id="amRank"></div></section>
   <div id="amList" class="aglist"></div>
   <section class="card"><h2>Plan de compensación</h2><div id="amPlan"></div></section>
   <section class="card" id="amNewC"><h2>Nuevo embajador</h2><div id="amNew"></div></section>`);
  const r=await api('/admin/ambassadors'+(AMON?`?month=${AMON}`:'')); AMON=r.month;
  const sel=$('#amMon'); sel.innerHTML=r.months.map(m=>`<option value="${m}" ${m===r.month?'selected':''}>${monLabel(m)}</option>`).join(''); sel.onchange=()=>{AMON=sel.value;viewAmbassadors()};
  const L=[...r.list].sort((a,b)=>b.month.segs-a.month.segs||b.month.sales-a.month.sales), T=r.totals, top=r.plan.tiers[r.plan.tiers.length-1];
  const mx=Math.max(1,...L.map(a=>a.month.sales));
  $('#amFx').innerHTML=`<div class="fx-grid">
    <div class="fx-cell">${fxDonut((()=>{const n=r.nets.slice(0,3),rest=r.nets.slice(3).reduce((t,x)=>t+x.sales,0);const out=n.map((x,i)=>({v:x.sales,cls:'c'+(i+1),label:x.label,txt:usd0(x.sales)}));if(rest)out.push({v:rest,cls:'c3',label:'Otras redes',txt:usd0(rest)});return out.length?out:[{v:0,cls:'c3',label:'Sin ventas este mes',txt:'—'}]})(),fxCount(T.sales,'usd'),'ventas del mes')}</div>
    <div class="fx-cell fx-wide"><div class="fx-h"><h2>Ventas por embajador</h2><p class="fine">${monLabel(r.month)} · el primero va en lima.</p></div>
     ${L.length?fxPills(L.slice(0,12).map((a,i)=>({label:a.code.slice(0,8),p:a.month.sales/mx,txt:a.month.segs?String(a.month.segs):'',on:i===0&&a.month.sales>0,aria:`${a.name}: ${a.month.segs} trayectos`,tip:`<b>${esc(a.name)}</b> · ${a.rank.name}<br>${a.month.segs} trayectos · ${money(a.month.sales)}<br>A pagar ${money(a.pay.total)}`})),{H:150}):'<p class="muted">Crea tu primer embajador abajo.</p>'}</div>
    <ul class="fx-stats"><li>${fxCount(T.active)}<span>embajadores activos</span></li><li>${fxCount(T.segs)}<span>trayectos vendidos</span></li><li>${fxCount(T.bookings)}<span>reservas emitidas</span></li><li>${fxCount(T.pay,'money')}<span>a pagar este mes</span></li></ul></div>
   <h3 class="fx-sub">Ventas por red social</h3>${r.nets.length?fxBars(r.nets.map(x=>({n:x.label,v:x.sales}))):'<p class="muted">Aún no hay compras con código este mes.</p>'}`;
  // ranking
  $('#amRank').innerHTML=L.length?`<div class="tw"><table class="tbl"><thead><tr><th>#</th><th>Embajador</th><th>Rango</th><th>Trayectos</th><th>Ventas</th><th>Comisión</th><th>Bono rango</th><th>Bono referidos</th><th>Total a pagar</th></tr></thead><tbody>${L.map((a,i)=>`<tr${a.active?'':' class="muted"'}><td><b>${i+1}</b></td><td><b>${esc(a.name)}</b><br><small class="muted">${a.code}</small></td><td><span class="rk r${a.rank.i}">${esc(a.rank.name)}</span><br><small class="muted">${a.rank.rate} %</small></td><td>${a.month.segs}</td><td>${money(a.month.sales)}</td><td>${money(a.pay.commission)}</td><td>${a.pay.bonus?money(a.pay.bonus):'—'}</td><td>${a.pay.override?money(a.pay.override):'—'}</td><td><b>${money(a.pay.total)}</b></td></tr>`).join('')}</tbody></table></div><p class="fine">Cuenta solo reservas emitidas (pagadas) en el mes. Si una reserva se anula, sale del cálculo.</p>`:'<p class="muted">Sin embajadores todavía.</p>';
  // tarjetas
  $('#amList').innerHTML=L.map(a=>{const nx=a.rank.next,p=nx?a.month.segs/nx.min:1;
    const links=SOC.filter(([k])=>a.socials[k]).map(([k,t])=>[k,t]).concat([['whatsapp','WhatsApp'],['','Sin red']]);
    return `<section class="card ag amb ${a.active?'':'off'}">
     <header class="ag-h"><div><h2>${esc(a.name)}</h2><p class="ag-tags"><span class="ctry code">${a.code}</span><span class="rk r${a.rank.i}">${esc(a.rank.name)} · ${a.rank.rate} %</span><span class="st ${a.active?'confirmed':'cancelled'}">${a.active?'Activo':'Inactivo'}</span></p></div>
      <span class="u-act"><button type="button" class="btn ghost sm" data-aview="${a.id}">Ver su pantalla</button><button type="button" class="btn ghost sm" data-aacc="${a.id}">${a.access?'Nueva contraseña':'Dar acceso al portal'}</button><button type="button" class="btn ghost sm" data-aed="${a.id}">Editar</button><button type="button" class="btn ghost sm" data-aon="${a.id}" data-v="${a.active?0:1}">${a.active?'Desactivar':'Activar'}</button></span></header>
     <div class="ag-fx">${fxGauge({small:1,p,val:`${fxCount(a.month.segs)}${nx?`<i class="fx-of">/ ${nx.min}</i>`:''}`,label:'trayectos del mes',sub:nx?`Faltan ${nx.missing} para ${esc(nx.name)} (${nx.rate} %)`:'Rango más alto alcanzado'})}
      <ul class="kpis sm ag-k"><li>${fxCount(a.month.sales,'money')}<span>ventas</span></li><li>${fxCount(a.pay.commission,'money')}<span>comisión ${a.rank.rate} %</span></li><li>${fxCount(a.pay.bonus+a.pay.override,'money')}<span>bonos</span></li><li class="due">${fxCount(a.pay.total,'money')}<span>a pagar</span></li></ul></div>
     <dl class="ag-dl">${[['Instagram',a.socials.instagram],['TikTok',a.socials.tiktok],['YouTube',a.socials.youtube],['Facebook',a.socials.facebook],['X',a.socials.x],['Correo',a.email],['Teléfono',a.phone],['Lo refirió',a.sponsor]].filter(x=>x[1]).map(([t,v])=>`<div><dt>${t}</dt><dd>${esc(v)}</dd></div>`).join('')||'<div><dd class="muted">Sin datos de contacto.</dd></div>'}</dl>
     <div class="ag-sec"><h3>De dónde vienen sus ventas</h3>${Object.keys(a.month.by).length?fxBars(Object.entries(a.month.by).sort((x,y)=>y[1].sales-x[1].sales).map(([k,v])=>({n:r.net_labels[k]||k,v:v.sales}))):'<p class="muted">Sin ventas este mes.</p>'}${a.pending?`<p class="fine">${a.pending} ${a.pending>1?'reservas pendientes':'reserva pendiente'} de pago con su código.</p>`:''}</div>
     <div class="ag-sec"><h3>Enlaces para compartir</h3><ul class="amlinks">${links.map(([k,t])=>`<li><span>${t}</span><code>${refUrl(a.code,k)}</code><button type="button" class="btn ghost sm" data-cp="${refUrl(a.code,k)}">Copiar</button></li>`).join('')}</ul><p class="fine">También puede dar su código ${a.code} para escribirlo al pagar; esas compras aparecen como «Código escrito».</p></div>
     <div class="ag-sec"><h3>Referidos <small class="muted">${a.referrals.length}</small></h3>${a.referrals.length?`<ul class="users">${a.referrals.map(x=>`<li><span class="u-id"><b>${esc(x.name)}</b><small>${x.code} · ${x.segs} trayectos este mes</small></span><span>${money(x.net)} tarifa neta</span></li>`).join('')}</ul><p class="fine">${a.pay.override_qualifies?`Gana ${r.plan.override} % de la tarifa neta de sus referidos: ${money(a.pay.override)}.`:`Para cobrar el ${r.plan.override} % de sus referidos debe vender al menos ${r.plan.override_min} trayectos en el mes.`}</p>`:'<p class="muted">Todavía no ha referido a otros embajadores.</p>'}</div>
     <p class="note ok tmpw amacc" hidden></p>
     <p class="fine">${a.access?`Portal del embajador: ${esc(a.access.email)} · ${a.access.pending?'aún no ha entrado':a.access.last_login?'último ingreso '+fmtDT(a.access.last_login):'sin ingresos'}`:'Todavía no tiene acceso a su portal.'}</p>
     <div class="amedit" data-aform="${a.id}"></div></section>`}).join('');
  const bindCopy=root=>$$('[data-cp]',root).forEach(b=>b.onclick=()=>{navigator.clipboard&&navigator.clipboard.writeText(b.dataset.cp);b.textContent='Copiado';setTimeout(()=>b.textContent='Copiar',1500)});
  bindCopy($('#amList'));
  $$('[data-aview]').forEach(b=>b.onclick=async()=>{const w=window.open('about:blank','_blank');try{const x=await api(`/admin/ambassadors/${b.dataset.aview}/view`,{body:{}});const u=location.origin+'/#as='+x.token;if(w)w.location=u;else location.href=u}catch(e){if(w)w.close();alert(e.message)}});
  $$('[data-aacc]').forEach(b=>b.onclick=async()=>{const a=L.find(x=>x.id===+b.dataset.aacc);if(a.access&&!confirm(`¿Crear una nueva contraseña temporal para ${a.name}? La actual dejará de funcionar.`))return;
    try{const x=await api(`/admin/ambassadors/${a.id}/access`,{body:{}});const box=b.closest('.amb').querySelector('.amacc');box.hidden=false;const fl=box.nextElementSibling;if(fl)fl.textContent=`Portal del embajador: ${x.email} · contraseña temporal creada, aún no ha entrado`;box.innerHTML=`Acceso al portal para <b>${esc(a.name)}</b>: entra en <b>${esc(location.host)}</b> con <b>${esc(x.email)}</b> y la contraseña temporal <code>${esc(x.password)}</code> <button type="button" class="btn ghost sm" data-cp="${esc(x.password)}">Copiar</button><br><small>Se muestra solo esta vez. Al entrar le pedirá crear su propia contraseña.</small>`;bindCopy(box)}catch(e){alert(e.message)}});
  $$('[data-aon]').forEach(b=>b.onclick=async()=>{await api('/admin/ambassadors/'+b.dataset.aon,{method:'PATCH',body:{active:b.dataset.v==='1'}});viewAmbassadors()});
  // formulario (nuevo y editar)
  const form=(a={})=>`<form class="ag-form amf"><label>Nombre<input name="name" value="${esc(a.name||'')}" required></label><label>Código<input name="code" value="${esc(a.code||'')}" placeholder="LAURA" required maxlength="16" style="text-transform:uppercase"></label>
    <label>Correo<input name="email" type="email" value="${esc(a.email||'')}"></label><label>Teléfono<input name="phone" value="${esc(a.phone||'')}"></label>
    ${SOC.map(([k,t])=>`<label>${t}<input name="s_${k}" value="${esc((a.socials||{})[k]||'')}" placeholder="@usuario"></label>`).join('')}
    <label>Lo refirió<select name="sponsor_id"><option value="">Nadie</option>${r.list.filter(x=>x.id!==a.id).map(x=>`<option value="${x.id}" ${x.id===a.sponsor_id?'selected':''}>${esc(x.name)} (${x.code})</option>`).join('')}</select></label>
    <label class="wide">Notas<input name="notes" value="${esc(a.notes||'')}" placeholder="Acuerdo, forma de pago…"></label>
    <div class="acts"><button class="btn lime">${a.id?'Guardar cambios':'Crear embajador'}</button>${a.id?'<button type="button" class="btn ghost" data-ax>Cancelar</button>':''}</div><p class="note" hidden></p></form>`;
  const collect=f=>{const d=Object.fromEntries(new FormData(f));const socials={};SOC.forEach(([k])=>{socials[k]=d['s_'+k];delete d['s_'+k]});d.socials=socials;return d};
  const nb=$('#amNew'); nb.innerHTML=form();
  const nf=$('form',nb); nf.name.oninput=()=>{if(!nf.code.dataset.touched) nf.code.value=nf.name.value.normalize('NFD').replace(/[^A-Za-z0-9]/g,'').toUpperCase().slice(0,10)}; nf.code.oninput=()=>nf.code.dataset.touched=1;
  nf.onsubmit=async e=>{e.preventDefault();try{await api('/admin/ambassadors',{body:collect(nf)});viewAmbassadors()}catch(err){note($('.note',nf),err.message,'err')}};
  $$('[data-aed]').forEach(b=>b.onclick=()=>{const a=r.list.find(x=>x.id===+b.dataset.aed),box=$(`[data-aform="${a.id}"]`);box.innerHTML=`<div class="ag-sec"><h3>Editar</h3>${form(a)}</div>`;
    const f=$('form',box);f.onsubmit=async e=>{e.preventDefault();try{await api('/admin/ambassadors/'+a.id,{method:'PATCH',body:collect(f)});viewAmbassadors()}catch(err){note($('.note',f),err.message,'err')}};
    $('[data-ax]',box).onclick=()=>box.innerHTML='';f.scrollIntoView({behavior:'smooth',block:'center'})});
  // plan
  const P=r.plan, hmax=Math.max(...P.tiers.map(t=>t.rate),1);
  $('#amPlan').innerHTML=`<p class="muted">Cada mes el embajador sube de rango según los trayectos que vende (pasajeros × tramos de reservas emitidas). La comisión de su rango se aplica a toda su tarifa neta del mes, sin impuestos, tasas ni extras.</p>
   <div class="ladder fx-wait">${P.tiers.map((t,i)=>`<div class="step r${i}" style="--h:${30+70*t.rate/hmax}%;--d:${i*120}ms"><div class="bar-s"><b>${t.rate} %</b>${t.bonus?`<small>+ ${usd0(t.bonus)}</small>`:''}</div><span class="rk r${i}">${esc(t.name)}</span><small>${t.min?`desde ${t.min} trayectos`:'desde el primer trayecto'}</small></div>`).join('')}</div>
   <p class="fine">Bono de referidos: ${P.override} % de la tarifa neta que vendan los embajadores que refirió, si ese mes vende al menos ${P.override_min} trayectos. Solo un nivel, y nunca se paga por inscribir a alguien, solo por ventas reales. El enlace dura ${P.window_days} días en el navegador del cliente.</p>
   <details class="pedit"><summary>Editar el plan</summary><form id="planF"><div class="tw"><table class="tbl"><thead><tr><th>Rango</th><th>Desde (trayectos/mes)</th><th>Comisión %</th><th>Bono al alcanzarlo (US$)</th><th></th></tr></thead><tbody>${P.tiers.map((t,i)=>`<tr><td><input name="name" value="${esc(t.name)}"></td><td><input name="min" type="number" min="0" value="${t.min}" ${i?'':'readonly'}></td><td><input name="rate" type="number" step="0.5" min="0" max="30" value="${t.rate}"></td><td><input name="bonus" type="number" min="0" value="${t.bonus||0}"></td><td>${i?'<button type="button" class="btn ghost sm" data-del>Quitar</button>':''}</td></tr>`).join('')}</tbody></table></div>
    <button type="button" class="btn ghost sm" id="addT">Agregar rango</button>
    <div class="ag-form" style="margin-top:14px"><label>Bono de referidos %<input name="override" type="number" step="0.5" min="0" max="10" value="${P.override}"></label><label>Mínimo propio para cobrarlo (trayectos)<input name="override_min" type="number" min="0" value="${P.override_min}"></label><label>Duración del enlace (días)<input name="window_days" type="number" min="1" max="90" value="${P.window_days}"></label></div>
    <div class="acts"><button class="btn lime">Guardar plan</button></div><p class="note" hidden></p></form></details>
   <p class="fine">Recuerda a tus embajadores que deben indicar que su publicación es publicidad pagada (por ejemplo #publicidad o #ad), como exigen las normas de publicidad en Estados Unidos y Colombia.</p>`;
  const pf=$('#planF'), tb=$('tbody',pf);
  const bindDel=()=>$$('[data-del]',pf).forEach(b=>b.onclick=()=>b.closest('tr').remove()); bindDel();
  $('#addT').onclick=()=>{tb.insertAdjacentHTML('beforeend','<tr><td><input name="name" placeholder="Nuevo rango"></td><td><input name="min" type="number" min="1"></td><td><input name="rate" type="number" step="0.5" min="0" max="30"></td><td><input name="bonus" type="number" min="0" value="0"></td><td><button type="button" class="btn ghost sm" data-del>Quitar</button></td></tr>');bindDel()};
  pf.onsubmit=async e=>{e.preventDefault();const tiers=$$('tbody tr',pf).map(tr=>({name:$('[name=name]',tr).value,min:$('[name=min]',tr).value,rate:$('[name=rate]',tr).value,bonus:$('[name=bonus]',tr).value}));
    try{await api('/admin/amb-plan',{method:'PUT',body:{tiers,override:pf.override.value,override_min:pf.override_min.value,window_days:pf.window_days.value}});viewAmbassadors()}catch(err){note($('.note',pf),err.message,'err')}};
}

/* ---------- admin: finanzas (proyección del modelo financiero) ---------- */
let FSC='medio';
const usdM=n=>{const a=Math.abs(n||0),s=n<0?'–':'';return a>=1e6?s+'US$'+(a/1e6).toLocaleString('es-CO',{maximumFractionDigits:2})+' M':a>=1e3?s+'US$'+Math.round(a/1e3).toLocaleString('es-CO')+' mil':s+'US$'+Math.round(a)};
// flujo de caja: barras del flujo neto (positivo/negativo) + línea del acumulado
function cashChart(ms,need){const W=760,H=280,P={l:66,r:14,t:20,b:34},iw=W-P.l-P.r,ih=H-P.t-P.b;
  const vals=ms.flatMap(m=>[m.net,m.cum]),mx=Math.max(...vals,0)*1.08,mn=Math.min(...vals,0)*1.15,y=v=>P.t+(mx-v)/(mx-mn)*ih,bw=iw/ms.length;
  let g=[mn,mn/2,0,mx/2,mx].map(t=>`<line x1="${P.l}" x2="${W-P.r}" y1="${y(t)}" y2="${y(t)}" class="${t===0?'cz':'cg'}"/><text x="${P.l-8}" y="${y(t)+4}" class="ca" text-anchor="end">${usdM(t)}</text>`).join('');
  ms.forEach((m,i)=>{const x=P.l+i*bw+bw*.22,w=bw*.56,y0=y(0),y1=y(m.net),h=Math.abs(y1-y0),neg=m.net<0;
    const tip=`<b>${m.month}</b><br>${m.ops_regular+m.ops_season} ${m.ops_regular+m.ops_season===1?'operación':'operaciones'} · ingreso ${money(m.revenue)}<br>Cobros ${money(m.collections)} · chárter y garantía ${money(m.charter)}<br>Flujo neto <b>${money(m.net)}</b><br>Acumulado ${money(m.cum)}`;
    g+=`<g class="hit" tabindex="0" data-tip="${esc(tip)}"><rect x="${P.l+i*bw}" y="${P.t}" width="${bw}" height="${ih}" fill="transparent"/>
      <rect x="${x}" y="${neg?y0:y1}" width="${w}" height="${Math.max(1,h)}" rx="4" class="cb ${neg?'neg':'pos'}" style="--d:${i*50}ms;transform-origin:${x+w/2}px ${y0}px"/>
      <text x="${x+w/2}" y="${H-12}" class="ca" text-anchor="middle">${m.month.replace('-',' ')}</text></g>`});
  const pts=ms.map((m,i)=>`${P.l+i*bw+bw/2},${y(m.cum)}`).join(' ');
  const lo=ms.reduce((a,m,i)=>m.cum<ms[a].cum?i:a,0);
  g+=`<polyline points="${pts}" class="cl" pathLength="100"/>${ms.map((m,i)=>`<circle cx="${P.l+i*bw+bw/2}" cy="${y(m.cum)}" r="${i===lo?5.5:3.5}" class="cd${i===lo?' lo':''}"/>`).join('')}
   <text x="${P.l+lo*bw+bw/2+12}" y="${y(ms[lo].cum)+4}" class="ca strong">Necesidad máxima ${usdM(-need)}</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" class="cash fx-wait" role="img" aria-label="Flujo de caja mensual del año 1">${g}</svg>`}
// sensibilidad: barras divergentes del EBITDA frente al caso base
function sensChart(rows,base){const max=Math.max(...rows.map(r=>Math.abs(r.ebitda-base)),1);
  return `<ul class="sens fx-wait">${rows.map((r,i)=>{const d=r.ebitda-base,w=Math.abs(d)/max*50;return `<li style="--d:${i*70}ms" tabindex="0" data-tip="${esc(`<b>${esc(r.name)}</b><br>Ingreso ${money(r.revenue)} · costo ${money(r.cost)}<br>EBITDA ${money(r.ebitda)} · margen ${Math.round(r.margin*100)} %`)}"><span class="sn">${esc(r.name)}</span>
    <span class="st2"><i class="${d<0?'neg':'pos'}" style="${d<0?`right:50%;width:${w}%`:`left:50%;width:${w}%`}"></i><b class="mid"></b></span><span class="sv">${usdM(r.ebitda)}<small>${d===0?'caso base':(d>0?'+':'')+usdM(d)}</small></span></li>`}).join('')}</ul>`}

function drawFund(F){
  const T=F.targets, A=F.fund, pctS=v=>v==null?'—':(v*100).toLocaleString('es-CO',{maximumFractionDigits:1})+' %';
  const st=(p,ok)=>ok?'<span class="st confirmed">Cumplida</span>':p>0?'<span class="st pending">En curso</span>':'<span class="st cancelled">Sin datos aún</span>';
  const rows=[
   ['Operaciones realizadas',String(T.ops),String(A.ops),A.ops/T.ops,A.ops>=T.ops,'Vuelos ida y vuelta completados','Mensual'],
   ['Ocupación de economía, ruta base',`${pctS(T.load)} (mínimo ${pctS(T.load_min)})`,A.load==null?'Sin vuelos aún':pctS(A.load),A.load==null?0:A.load/T.load,A.load!=null&&A.load>=T.load,'Sillas vendidas sobre sillas ofrecidas, vuelos ya volados','Por vuelo'],
   ['Pasajeros transportados',T.pax.toLocaleString('es-CO'),A.pax.toLocaleString('es-CO'),A.pax/T.pax,A.pax>=T.pax,'Pasajeros por tramo en vuelos ya volados','Mensual'],
   ['Ingreso total',usdM(T.revenue),usdM(A.revenue),A.revenue/T.revenue,A.revenue>=T.revenue,'Reservas emitidas de vuelos ya volados','Trimestral'],
   ['EBITDA (estimado)',usdM(T.ebitda),usdM(A.ebitda_est),Math.max(0,A.ebitda_est)/T.ebitda,A.ebitda_est>=T.ebitda,'Ingreso volado menos chárter de las operaciones y pasarela (3,2 %)','Trimestral'],
   ['Ingresos no tarifarios sobre el ingreso',pctS(T.nontariff),pctS(A.nontariff),A.nontariff==null?0:A.nontariff/T.nontariff,A.nontariff!=null&&A.nontariff>=T.nontariff,'Asientos, equipaje y extras sobre el ingreso volado (sin carga ni publicidad aún)','Trimestral'],
   ['Beneficiarios de turismo social',String(T.social),String(A.social),A.social/T.social,A.social>=T.social,'Cupos sociales usados, registrados por vuelo','Por vuelo'],
   ['Prestadores locales vinculados','Red de Cotelco Quindío',String(A.providers),A.providers?1:0,false,'Hospedajes, guías y comercios en los programas','Trimestral'],
   ['Ayuda humanitaria transportada',`${T.aid_t.toLocaleString('es-CO')} t`,`${A.aid_t.toLocaleString('es-CO')} t`,A.aid_t/T.aid_t,A.aid_t>=T.aid_t,'Kilogramos en bodega, registrados por vuelo','Por vuelo']];
  const done=rows.filter(r=>r[4]).length, avg=rows.slice(0,7).reduce((t,r)=>t+Math.min(1,r[3]||0),0)/7;
  $('#fFund').innerHTML=`<p class="muted">Las metas del año 1 que presentaste al Fondo, con el avance real. Las primeras cinco se calculan solas con las reservas; el impacto social lo registras tú por vuelo.</p>
   <div class="fx-grid rs"><div class="fx-cell">${fxGauge({p:avg,val:fxCount(avg*100,'pct'),label:'avance promedio',sub:`${done} de ${rows.length} metas cumplidas`})}</div>
   <div class="tw"><table class="tbl fund"><thead><tr><th>Indicador</th><th>Meta del año 1</th><th>Real a la fecha</th><th>Avance</th><th>Estado</th><th>Frecuencia</th></tr></thead><tbody>${rows.map(([n,m,r,p,ok,how,fr])=>`<tr><td><b>${n}</b><br><small class="muted">${how}</small></td><td>${m}</td><td><b>${r}</b></td><td>${fxMini(Math.min(1,p||0),Math.round(Math.min(9.99,p||0)*100)+' %')}</td><td>${st(p,ok)}</td><td>${fr}</td></tr>`).join('')}</tbody></table></div></div>
   <div class="fin2 imp-reg"><form id="impF" class="ag-form"><h3 class="wide2">Registrar impacto de un vuelo</h3><label>Ruta<select name="route"><option value="MIA-AXM">Miami → Armenia</option><option value="AXM-MIA">Armenia → Miami</option><option value="MIA-BAQ">Miami → Barranquilla</option><option value="BAQ-MIA">Barranquilla → Miami</option></select></label><label>Fecha del vuelo<input type="date" name="date" required></label><label>Cupos sociales usados<input type="number" name="social" min="0" max="150" value="0"></label><label>Ayuda humanitaria (kg)<input type="number" name="aid_kg" min="0" max="20000" value="0"></label><label class="wide2">Nota (región, fundación…)<input name="notes"></label><div class="acts wide2"><button class="btn lime">Guardar</button></div><p class="note wide2" hidden></p></form>
    <div><h3>Prestadores locales vinculados</h3><form id="provF" class="ag-cond"><label>Hospedajes, guías y comercios<input type="number" name="n" min="0" value="${A.providers}"></label><span></span><button class="btn ghost">Guardar</button></form>
    <h3 style="margin-top:16px">Vuelos registrados</h3>${F.impact_log.length?`<ul class="users">${F.impact_log.map(x=>`<li><span class="u-id"><b>${x.flight.split('|')[0].replace('-',' → ')} · ${fmtD(x.flight.split('|')[1])}</b><small>${esc(x.notes||'')}</small></span><span>${x.social} cupos · ${x.aid_kg.toLocaleString('es-CO')} kg</span></li>`).join('')}</ul>`:'<p class="muted">Aún no has registrado vuelos.</p>'}</div></div>`;
  const f=$('#impF');f.onsubmit=async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(f));try{await api('/admin/impact',{body:{flight:d.route+'|'+d.date,social:d.social,aid_kg:d.aid_kg,notes:d.notes}});viewFinance()}catch(err){note($('.note',f),err.message,'err')}};
  const pf=$('#provF');pf.onsubmit=async e=>{e.preventDefault();await api('/admin/providers',{method:'PUT',body:{n:pf.n.value}});viewFinance()};
}
async function drawDocs(){
  const box=$('#fDocs'); if(!box) return; const list=await api('/admin/docs');
  const kb=n=>n>1e6?(n/1e6).toLocaleString('es-CO',{maximumFractionDigits:1})+' MB':Math.round(n/1e3)+' KB';
  box.innerHTML=`<p class="muted">El informe, el modelo y los anexos que entregaste. Quedan guardados en tu servidor y solo los descarga un administrador con sesión iniciada; no se publican en la web ni en GitHub.</p>
   ${list.length?`<ul class="docs">${list.map(d=>`<li><span class="dk ${d.kind}">${d.kind.toUpperCase()}</span><span class="u-id"><b>${esc(d.name)}</b><small>${kb(d.size)} · subido el ${fmtDT(d.uploaded)}${d.is_model?' · <span class="st confirmed">modelo activo</span>':''}</small></span><span class="u-act"><button class="btn ghost sm" data-dl="${d.id}" data-n="${esc(d.name)}">Descargar</button><button class="btn ghost sm danger" data-rm="${d.id}">Quitar</button></span></li>`).join('')}</ul>`:'<p class="muted">Aún no hay documentos.</p>'}
   <form id="upF" class="upf"><label class="drop"><input type="file" name="f" accept=".pdf,.xlsx,.docx,.pptx" multiple><span>Arrastra aquí o elige archivos PDF, Excel, Word o PowerPoint (máximo 30 MB cada uno)</span></label>
    <label class="chk"><input type="checkbox" name="model"> Es el modelo financiero: actualiza las cifras de Finanzas y del Tablero</label><button class="btn lime">Subir</button><p class="note" hidden></p></form>`;
  $$('[data-dl]',box).forEach(b=>b.onclick=async()=>{b.textContent='Descargando…';const r=await fetch('/api/admin/docs/'+b.dataset.dl+'/file',{headers:{Authorization:'Bearer '+token}});
    if(!r.ok){b.textContent='Error';return}const u=URL.createObjectURL(await r.blob()),a=document.createElement('a');a.href=u;a.download=b.dataset.n;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),4000);b.textContent='Descargar'});
  $$('[data-rm]',box).forEach(b=>b.onclick=async()=>{if(!confirm('¿Quitar este documento del portal?'))return;await api('/admin/docs/'+b.dataset.rm,{method:'DELETE'});drawDocs()});
  const f=$('#upF'),n=$('.note',f),drop=$('.drop',f);
  f.f.onchange=()=>{$('span',drop).textContent=[...f.f.files].map(x=>x.name).join(', ')||'Elige archivos'};
  drop.ondragover=e=>{e.preventDefault();drop.classList.add('over')};drop.ondragleave=()=>drop.classList.remove('over');drop.ondrop=e=>{e.preventDefault();drop.classList.remove('over');f.f.files=e.dataTransfer.files;f.f.onchange()};
  f.onsubmit=async e=>{e.preventDefault();const files=[...f.f.files];if(!files.length)return note(n,'Elige al menos un archivo.','err');
    if(f.model.checked&&!(files.length===1&&files[0].name.toLowerCase().endsWith('.xlsx')))return note(n,'Para actualizar el modelo sube un solo archivo de Excel (.xlsx).','err');
    let model=false;for(const file of files){note(n,`Subiendo ${file.name}…`,'ok');
      const r=await fetch('/api/admin/docs'+(f.model.checked?'?model=1':''),{method:'POST',headers:{Authorization:'Bearer '+token,'X-File-Name':encodeURIComponent(file.name)},body:file});
      const j=await r.json().catch(()=>({}));if(!r.ok)return note(n,j.error||'No pudimos subir el archivo.','err');model=model||j.model}
    if(model) return viewFinance(); drawDocs()};
}
async function viewFinance(){
  shell(adminTabs,'finanzas',`<section class="card"><div class="hd"><div><h1>Finanzas</h1><p class="muted" id="fSrc"></p></div><div class="seg" role="group" aria-label="Escenario" id="fSc"></div></div><div id="fTop"><p class="muted">Cargando…</p></div></section>
   <section class="card" id="fFundC"><h2>Seguimiento del Fondo</h2><div id="fFund"></div></section>
   <section class="card"><h2>Documentos del Fondo</h2><div id="fDocs"></div></section>
   <div class="fin2"><section class="card"><h2>Estado de resultados del año 1</h2><div id="fPL"></div></section><section class="card"><h2>OPEX y CAPEX</h2><div id="fOpex"></div></section></div>
   <section class="card"><h2>Flujo de caja mensual y capital de trabajo</h2><div id="fCash"></div></section>
   <div class="fin2"><section class="card"><h2>Sensibilidad del EBITDA</h2><div id="fSens"></div></section><section class="card"><h2>Expansión de flota a cinco años</h2><div id="fExp"></div></section></div>
   <section class="card"><h2>Impacto social y económico</h2><div id="fImp"></div></section>`);
  const F=await api('/admin/finance'); drawDocs();
  if(F.missing){$('#fTop').innerHTML='<p>Todavía no has subido el modelo financiero. Súbelo en «Documentos del Fondo» marcando la casilla «Es el modelo financiero» y esta pestaña se llena sola con sus cifras.</p>';
    const first=$('#main>section');$$('#main>section,#main>.fin2').forEach(x=>{if(x!==first&&!x.contains($('#fDocs')))x.hidden=true});return}
  drawFund(F);
  const Y=F.year1, s=FSC, k=x=>x[s];
  $('#fSrc').textContent=`Proyección del modelo financiero · ${F.period}. Fuente: ${F.source}, del ${fmtD(F.updated,{day:'numeric',month:'long',year:'numeric'})}.`;
  $('#fSc').innerHTML=Object.entries(F.scenarios).map(([key,t])=>`<button type="button" data-sc="${key}" aria-pressed="${key===s}">${t} · ${Math.round(Y.load[key]*100)} %</button>`).join('');
  $$('[data-sc]').forEach(b=>b.onclick=()=>{FSC=b.dataset.sc;viewFinance()});
  const opexS=k(Y.cost), real=F.actual.emitted, planY=Y.revenue.medio;
  $('#fTop').innerHTML=`<div class="fx-grid fin">
    <div class="fx-cell">${fxGauge({p:k(Y.margin),mark:.4,markLabel:'Medio: 40 %',val:fxCount(k(Y.margin)*100,'pct'),label:'margen EBITDA',sub:`escenario ${F.scenarios[s].toLowerCase()} · ocupación ${Math.round(k(Y.load)*100)} %`})}</div>
    <div class="fx-cell">${fxDonut([{v:k(Y.ebitda),cls:'c1',label:'EBITDA',txt:usdM(k(Y.ebitda))},{v:k(Y.charter_regular)+k(Y.charter_season),cls:'c2',label:'Chárter',txt:usdM(k(Y.charter_regular)+k(Y.charter_season))},{v:opexS-k(Y.charter_regular)-k(Y.charter_season),cls:'c3',label:'Otros costos',txt:usdM(opexS-k(Y.charter_regular)-k(Y.charter_season))}],fxCount(k(Y.revenue),'usdm'),'ingreso del año')}</div>
    <ul class="fx-stats two"><li>${fxCount(k(Y.ebitda),'usd')}<span>EBITDA del año 1</span></li><li>${fxCount(opexS,'usd')}<span>OPEX total</span></li><li>${fxCount(0,'usd')}<span>CAPEX (modelo chárter)</span></li><li>${fxCount(F.cash.need,'usd')}<span>necesidad máxima de caja</span></li><li>${fxCount(k(Y.pax))}<span>pasajeros · ${k(Y.ops)} operaciones</span></li><li>${fxCount(k(Y.rev_per_op),'usd')}<span>ingreso por operación (chárter ${usd0(k(Y.charter_per_op))})</span></li></ul></div>
   <div class="fin-real"><span>Ventas reales emitidas hasta hoy: <b>${money(real)}</b>, el ${(real/planY*100).toLocaleString('es-CO',{maximumFractionDigits:1})} % del ingreso del escenario medio.</span>${fxMini(real/planY,'')}<a href="#tablero">Ver el avance en el Tablero</a></div>`;
  // estado de resultados
  const pl=[['Ingresos ruta regular Miami–Armenia','rev_regular',1],['Ingresos vuelos de temporada','rev_season',1],['Ingreso total','revenue',2],['Chárter ruta regular','charter_regular',-1],['Chárter temporada','charter_season',-1],['Gastos propios','own',-1],['Pasarela de pagos, temporada','gateway_season',-1],['Marketing compartido','marketing',-1],['Costo total (OPEX)','cost',3],['EBITDA','ebitda',4]];
  $('#fPL').innerHTML=`<div class="tw"><table class="tbl pl"><thead><tr><th>US$</th>${Object.entries(F.scenarios).map(([key,t])=>`<th class="${key===s?'on':''}">${t}</th>`).join('')}</tr></thead><tbody>${pl.map(([t,key,kind])=>`<tr class="k${kind}"><td>${t}</td>${Object.keys(F.scenarios).map(sc=>`<td class="${sc===s?'on':''}">${kind<0?'–':''}${usd0(Y[key][sc])}</td>`).join('')}</tr>`).join('')}
    <tr class="k5"><td>Margen EBITDA</td>${Object.keys(F.scenarios).map(sc=>`<td class="${sc===s?'on':''}">${Math.round(Y.margin[sc]*100)} %</td>`).join('')}</tr></tbody></table></div>
   <h3 class="fx-sub">De dónde viene el ingreso · ${F.scenarios[s].toLowerCase()}</h3>${fxBars([{n:'Tiquetes ruta regular',v:k(Y.tickets_regular)},{n:'No tarifario ruta regular',v:k(Y.nontariff_regular)},{n:'Tiquetes temporada',v:k(Y.tickets_season)},{n:'Complementario temporada',v:k(Y.compl_season)},{n:'Publicidad a bordo',v:k(Y.ads_regular)}],'usd')}
   <p class="fine">EBITDA: resultado antes de intereses, impuestos, depreciación y amortización. Como la operación es chárter no hay depreciación de flota ni deuda, así que coincide con la utilidad antes de impuestos.</p>`;
  // opex / capex
  const ch=F.opex[0], rest=F.opex.slice(1);
  $('#fOpex').innerHTML=`<div class="fx-dn-wrap">${fxDonut([{v:ch.usd,cls:'c1',label:ch.name,txt:`${Math.round(ch.share*100)} %`},{v:F.opex_total-ch.usd,cls:'c2',label:'Resto de gastos',txt:`${Math.round((1-ch.share)*100)} %`}],fxCount(F.opex_total,'usdm'),'OPEX · escenario medio')}</div>
   <h3 class="fx-sub">El otro ${Math.round((1-ch.share)*1000)/10} % del OPEX</h3>${fxBars(rest.map(c=>({n:c.name,v:c.usd})),'usd')}
   <ul class="fnotes">${F.opex.filter(c=>c.note).map(c=>`<li><b>${esc(c.name)}:</b> ${esc(c.note)}</li>`).join('')}</ul>
   <div class="capex"><div><b>CAPEX: US$0</b><span>${esc(F.capex.note)}</span></div><div><b>Capital de trabajo: ${usd0(F.cash.need)}</b><span>Es la caja que hay que tener antes del primer vuelo: anticipo de 8 operaciones (${usd0(F.cash.advance)}) y garantía del contrato (${usd0(F.cash.guarantee)}), menos la preventa cobrada.</span></div></div>`;
  // flujo de caja
  const M=F.cash.months, lo=M.reduce((a,m)=>m.cum<a.cum?m:a,M[0]), end=M[M.length-1];
  $('#fCash').innerHTML=`<div class="fx-grid rs"><ul class="fx-stats"><li>${fxCount(F.cash.need,'usd')}<span>necesidad máxima de caja (${lo.month})</span></li><li>${fxCount(end.cum,'usd')}<span>caja acumulada al cierre (${end.month})</span></li><li>${fxCount(M.filter(m=>m.net<0).length)}<span>meses con flujo negativo</span></li></ul>
    <div class="fx-cell fx-wide">${cashChart(M,F.cash.need)}<p class="fine"><span class="lg pos"></span>Flujo neto positivo <span class="lg neg"></span>Flujo neto negativo <span class="lg ln"></span>Caja acumulada</p></div></div>
   <p class="fine">Supuestos del modelo: ${Math.round(F.cash.presale_share*100)} % de la venta se cobra el mes anterior al vuelo; la pasarela retiene ${Math.round(F.cash.retention*100)} % y lo libera a los 3 meses; el chárter se paga por bloques de 8 operaciones antes de volarlas. Escenario medio, sin deuda ni aportes de capital.</p>`;
  // sensibilidad
  const base=F.sensitivity.find(r=>r.name.startsWith('Ocupación 80'))||F.sensitivity[0];
  $('#fSens').innerHTML=sensChart(F.sensitivity.filter(r=>r.name!=='Caso personalizado'),base.ebitda)+`<p class="fine">Cada barra muestra cuánto cambia el EBITDA frente al caso base (80 % de ocupación). El riesgo del modelo es de ocupación, no de estructura: el EBITDA sigue positivo incluso en el caso de estrés.</p>`;
  // expansión
  const X=F.expansion, mxe=Math.max(...X.map(e=>e.ebitda));
  $('#fExp').innerHTML=`${fxPills(X.map((e,i)=>({label:String(e.year),p:e.ebitda/mxe,txt:usdM(e.ebitda),on:i===X.length-1,aria:`${e.year}: EBITDA ${usdM(e.ebitda)}`,tip:`<b>${e.year} · ${e.aircraft} aviones</b><br>${e.ops.toLocaleString('es-CO')} operaciones · ${Math.round(e.pax).toLocaleString('es-CO')} pasajeros<br>Ingreso ${usdM(e.revenue)} · chárter ${usdM(e.charter)}<br>EBITDA ${usdM(e.ebitda)} · margen ${Math.round(e.margin*100)} %`})),{H:170})}
   <div class="tw"><table class="tbl xs"><thead><tr><th></th>${X.map(e=>`<th>${e.year}</th>`).join('')}</tr></thead><tbody>
    <tr><td>Aviones</td>${X.map(e=>`<td>${e.aircraft}</td>`).join('')}</tr><tr><td>Operaciones</td>${X.map(e=>`<td>${e.ops.toLocaleString('es-CO')}</td>`).join('')}</tr>
    <tr><td>Ingreso</td>${X.map(e=>`<td>${usdM(e.revenue)}</td>`).join('')}</tr><tr><td>Margen</td>${X.map(e=>`<td>${Math.round(e.margin*100)} %</td>`).join('')}</tr></tbody></table></div>
   <p class="fine">Escenario ilustrativo del informe, por validar con el Fondo. No incluye inversiones de capital, capital de trabajo ni la certificación como operador regular.</p>`;
  // impacto
  const I=F.impact, ik=x=>x[s];
  $('#fImp').innerHTML=`<ul class="fx-stats imp"><li>${fxCount(ik(I.visitors))}<span>visitantes a la región</span></li><li>${fxCount(ik(I.spend),'usd')}<span>gasto que dejan en la región</span></li><li>${fxCount(ik(I.jobs))}<span>empleos apoyados</span></li><li>${fxCount(ik(I.social))}<span>beneficiarios de cupos sociales</span></li><li>${fxCount(ik(I.aid_t))}<span>toneladas de ayuda humanitaria</span></li><li>${fxCount(ik(I.inkind),'usd')}<span>aporte en especie de Beemo Air</span></li></ul>
   <p class="fine">Año 1, escenario ${F.scenarios[s].toLowerCase()}. En el año 5 de la expansión: ${Math.round(I.visitors.y5).toLocaleString('es-CO')} visitantes, ${usdM(I.spend.y5)} de gasto en la región y ${Math.round(I.jobs.y5).toLocaleString('es-CO')} empleos apoyados. Gasto y empleos son estimados por validar con el Fondo.</p>`;
}

/* ---------- router ---------- */
async function boot(){
  if(dashUnmount){try{dashUnmount()}catch(e){} dashUnmount=null}
  if(chUnmount){try{chUnmount()}catch(e){} chUnmount=null}
  if(!token){return viewLogin()}
  if(!me){try{me=await api('/me')}catch(e){return}}
  if(me.must_change) return viewPassword();
  const h=location.hash.slice(1);
  try{
    if(me.role==='admin'){({tablero:viewDashboard,vuelos:viewFlights,temporadas:viewSeasons,reservas:viewAdminBookings,finanzas:viewFinance,agencias:viewAgencies,embajadores:viewAmbassadors,club:viewClubAdmin,pases:viewPasses,soporte:viewSupport,actividad:viewLog}[h]||viewDashboard)()}
    else if(me.role==='ambassador'){({ventas:viewAmbSales,enlaces:viewAmbLinks}[h]||viewAmbSales)()}
    else{({inicio:viewHome,nueva:viewNew,vuelos:viewAgentFlights,reservas:viewBookings,cuenta:viewStatement,club:viewClubAgent,material:viewMaterial,soporte:viewSupport}[h]||viewHome)()}
  }catch(e){console.error(e)}
}
window.addEventListener('hashchange',boot);
window.addEventListener('unhandledrejection',e=>{const m=$('#main');if(m&&e.reason&&e.reason.message){const p=document.createElement('p');p.className='note err';p.textContent=e.reason.message;m.prepend(p)}});
boot();
})();
