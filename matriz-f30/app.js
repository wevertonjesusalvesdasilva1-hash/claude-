(function(){
"use strict";

var LV=[null,
 {n:1,pct:0,  t:"NÃO SABE NADA",             d:"Sem conhecimento ou prática na peça"},
 {n:2,pct:25, t:"PRECISA DE ACOMPANHAMENTO", d:"Executa com supervisão e suporte"},
 {n:3,pct:50, t:"CONSEGUE TRABALHAR SEM",    d:"Trabalha sozinho, sem acompanhamento"},
 {n:4,pct:75, t:"SABE E CONSEGUE ENSINAR",   d:"Domina a peça e multiplica"},
 {n:5,pct:100,t:"REFERÊNCIA DO PROCESSO",    d:"Domina, ensina e melhora o padrão"}];


/* ------------- estado e acesso ao Supabase ------------- */
var SB=null, MES=30.44*24*3600*1000;
var S={
  proc:"TW",view:"geral",comp:"pessoas",baseTab:"pessoas",assign:false,
  people:[],pieces:[],grid:{},cfg:{validade:6,demo:false},
  who:null,duelA:null,duelB:null,
  mode:"boot",canWrite:false,uid:null,email:"",names:{},ready:false
};
var $=function(s){return document.querySelector(s)};
function el(t,c,x){var n=document.createElement(t);if(c)n.className=c;if(x!=null)n.textContent=x;return n}
function newPid(){return "p"+Date.now().toString(36)+Math.random().toString(36).slice(2,6)}
function nextPieceId(){var m=0;S.pieces.forEach(function(p){if(p.id>m)m=p.id});return m+1}
function gk(pid,proc){return pid+"__"+proc}
function first2(n){var a=String(n||"").trim().split(/\s+/);return a[0]+(a[1]?" "+a[1]:"")}
function byId(id){return S.people.filter(function(p){return p.id===id})[0]}

function g(pid,proc){var k=gk(pid,proc||S.proc);return S.grid[k]||(S.grid[k]={lv:{},asg:{},ts:{}})}
function getL(pid,pcId){var v=g(pid).lv[pcId];return v?v:1}
function isAsg(pid,pcId){var a=g(pid).asg;return !!(a&&a[pcId])}
function getTs(pid,pcId){return g(pid).ts[pcId]||0}
function isOld(pid,pcId){
  if(!isAsg(pid,pcId))return false;
  var t=getTs(pid,pcId);if(!t)return true;
  return (Date.now()-t)>S.cfg.validade*MES;
}
function inProc(pc){return pc.procs==="AMBOS"||pc.procs===S.proc}
function countAsg(pid,proc){var a=(S.grid[gk(pid,proc)]||{}).asg||{};var n=0;
  S.pieces.forEach(function(p){if((p.procs==="AMBOS"||p.procs===proc)&&a[p.id])n++});return n}
function myPieces(p,pcs){return pcs.filter(function(pc){return isAsg(p.id,pc.id)})}
function whoDoes(pc,ppl){return ppl.filter(function(p){return isAsg(p.id,pc.id)})}
function pStat(p,pcsAll){
  var pcs=myPieces(p,pcsAll),s=0,h=0,old=0;
  pcs.forEach(function(pc){var L=getL(p.id,pc.id);s+=LV[L].pct;if(L>=pc.goal)h++;if(isOld(p.id,pc.id))old++});
  return{avg:pcs.length?s/pcs.length:0,hit:h,n:pcs.length,old:old};
}
function cStat(pc,pplAll){
  var ppl=whoDoes(pc,pplAll),r=0;
  ppl.forEach(function(p){if(getL(p.id,pc.id)>=pc.goal)r++});
  var st="ok";
  if(ppl.length===0)st="n";else if(r===0)st="b";else if(pc.crit&&r<2)st="b";else if(r<2)st="w";
  return{ready:r,total:ppl.length,status:st};
}
function canWrite(){return S.canWrite===true}
function requireWrite(){
  if(canWrite())return true;
  toast("Entre com sua conta para alterar a matriz.");
  return false;
}

/* ------------- gravacao ------------- */
var pend={},inflight={};
function erro(e){
  var m=(e&&(e.message||e.msg))||"";
  if(/JWT|session|403|401/i.test(m)){S.canWrite=false;setConn();toast("Sua sessão expirou. Entre de novo.");abrirLogin();return}
  toast("Não consegui salvar: "+(m||"erro de rede")+". A tela voltou ao valor do banco.");
  carregarNiveis();
}
function gravaCelula(pid,pcId){
  var key=pid+"|"+pcId+"|"+S.proc;
  if(pend[key])return; pend[key]=true;
  setTimeout(function(){
    pend[key]=false;
    var d=g(pid),lvl=d.lv[pcId]||1,asg=!!(d.asg&&d.asg[pcId]),ts=d.ts[pcId]||Date.now();
    SB.from("levels").upsert({
      person_id:pid,piece_id:Number(pcId),proc:S.proc,
      assigned:asg,level:lvl,
      rated_at:new Date(ts).toISOString(),
      updated_at:new Date().toISOString(),updated_by:S.uid
    },{onConflict:"person_id,piece_id,proc"}).then(function(r){if(r.error)erro(r.error)});
  },400);
}
function logAudit(rows){
  if(!rows.length)return;
  rows.forEach(function(r){r.actor=S.uid;r.actor_email=S.email});
  SB.from("audit").insert(rows).then(function(){});
}
function setLevel(pid,pcId,v){
  if(!requireWrite())return;
  var d=g(pid),from=d.lv[pcId]||1;
  if(from===v)return;
  d.lv[pcId]=v;d.ts[pcId]=Date.now();
  gravaCelula(pid,pcId);
  logAudit([{person_id:pid,piece_id:Number(pcId),proc:S.proc,kind:"nivel",from_level:from,to_level:v}]);
}
function toggleAsgW(pid,pcId){
  if(!requireWrite())return;
  var d=g(pid),on=!!(d.asg&&d.asg[pcId]);
  if(on)delete d.asg[pcId]; else {d.asg[pcId]=1;if(!d.ts[pcId])d.ts[pcId]=Date.now()}
  gravaCelula(pid,pcId);
  logAudit([{person_id:pid,piece_id:Number(pcId),proc:S.proc,kind:on?"tirar":"atribuir"}]);
}
function setAllAsgW(pid,on){
  if(!requireWrite())return;
  var d=g(pid),alvo=S.pieces.filter(inProc),rows=[];
  d.asg=d.asg||{};
  alvo.forEach(function(p){
    if(on){if(!d.asg[p.id]){d.asg[p.id]=1;if(!d.ts[p.id])d.ts[p.id]=Date.now()}}
    else delete d.asg[p.id];
    rows.push({person_id:pid,piece_id:p.id,proc:S.proc,assigned:on,
      level:d.lv[p.id]||1,rated_at:new Date(d.ts[p.id]||Date.now()).toISOString(),
      updated_at:new Date().toISOString(),updated_by:S.uid});
  });
  SB.from("levels").upsert(rows,{onConflict:"person_id,piece_id,proc"}).then(function(r){if(r.error)erro(r.error)});
  logAudit([{person_id:pid,proc:S.proc,kind:"lote",note:on?"todas as peças atribuídas":"todas as peças retiradas"}]);
}
function savePerson(p){
  if(!requireWrite())return;
  SB.from("people").upsert({id:p.id,chapa:p.chapa||"",name:p.name||"",role:p.role||"",turno:p.turno||""})
    .then(function(r){if(r.error)erro(r.error)});
}
function delPerson(p){
  if(!requireWrite())return;
  S.people=S.people.filter(function(x){return x.id!==p.id});
  if(S.who===p.id)S.who=S.people[0]?S.people[0].id:null;
  SB.from("people").delete().eq("id",p.id).then(function(r){if(r.error)erro(r.error)});
}
function savePiece(pc){
  if(!requireWrite())return;
  SB.from("pieces").upsert({id:pc.id,name:pc.name||"",cat:pc.cat||"",crit:!!pc.crit,
    goal:pc.goal||3,procs:pc.procs||"AMBOS",codes:Number(pc.codes)||0,apps:pc.apps||""})
    .then(function(r){if(r.error)erro(r.error)});
}
function delPiece(pc){
  if(!requireWrite())return;
  S.pieces=S.pieces.filter(function(x){return x.id!==pc.id});
  SB.from("pieces").delete().eq("id",pc.id).then(function(r){if(r.error)erro(r.error)});
}
function saveCfg(){
  if(!requireWrite())return;
  SB.from("config").upsert({id:1,validade:S.cfg.validade,demo:!!S.cfg.demo})
    .then(function(r){if(r.error)erro(r.error)});
}
/* ------------- pizza ------------- */
var NS="http://www.w3.org/2000/svg";
function wedgePath(p){
  if(p>=100)return "M15,2 A13,13 0 1 1 14.99,2 Z";
  var a=p/100*360,rad=(a-90)*Math.PI/180;
  return "M15,15 L15,2 A13,13 0 "+(a>180?1:0)+" 1 "+(15+13*Math.cos(rad)).toFixed(3)+","+(15+13*Math.sin(rad)).toFixed(3)+" Z";
}
function pie(L,size){
  var s=size||30,svg=document.createElementNS(NS,"svg");
  svg.setAttribute("viewBox","0 0 30 30");svg.setAttribute("width",s);svg.setAttribute("height",s);
  var ring=document.createElementNS(NS,"circle");ring.setAttribute("class","ring");
  ring.setAttribute("cx","15");ring.setAttribute("cy","15");ring.setAttribute("r","13");svg.appendChild(ring);
  if(LV[L].pct>0){var w=document.createElementNS(NS,"path");w.setAttribute("class","wedge");
    w.setAttribute("d",wedgePath(LV[L].pct));svg.appendChild(w)}
  var gg=document.createElementNS(NS,"g");gg.setAttribute("class","divs");
  [0,90,180,270].forEach(function(a){
    var rad=(a-90)*Math.PI/180,ln=document.createElementNS(NS,"line");
    ln.setAttribute("x1","15");ln.setAttribute("y1","15");
    ln.setAttribute("x2",(15+13*Math.cos(rad)).toFixed(2));
    ln.setAttribute("y2",(15+13*Math.sin(rad)).toFixed(2));
    gg.appendChild(ln);
  });
  svg.appendChild(gg);return svg;
}
function pieKey(L,size,below){
  var b=el("span","hb "+(below?"below":"ok")+" key");
  b.style.cssText="width:"+(size||18)+"px;height:"+(size||18)+"px;flex:0 0 auto";
  b.appendChild(pie(L,size||18));return b;
}
function toast(m){var t=$("#toast");t.textContent=m;t.classList.add("on");clearTimeout(toast._);toast._=setTimeout(function(){t.classList.remove("on")},2800)}
function ago(t){
  if(!t)return "nunca avaliado";
  var d=Math.floor((Date.now()-t)/(24*3600*1000));
  if(d<1)return "avaliado hoje";
  if(d<30)return "avaliado há "+d+(d>1?" dias":" dia");
  var m=Math.round(d/30.44);
  return "avaliado há "+m+(m>1?" meses":" mês");
}
function dstr(t){var d=new Date(t);
  return ("0"+d.getDate()).slice(-2)+"/"+("0"+(d.getMonth()+1)).slice(-2)+"/"+d.getFullYear();}

/* ------------- filtros ------------- */
function people(){
  var q=$("#q").value.trim().toLowerCase(),t=$("#fTurno").value,c=$("#fCargo").value,
      gp=$("#fGap").checked,od=$("#fOld").checked,pcs=pieces();
  return S.people.filter(function(p){
    if(q&&String(p.name).toLowerCase().indexOf(q)<0&&String(p.chapa).indexOf(q)<0)return false;
    if(t&&p.turno!==t)return false;
    if(c&&p.role!==c)return false;
    if(gp&&!pcs.some(function(pc){return isAsg(p.id,pc.id)&&getL(p.id,pc.id)<pc.goal}))return false;
    if(od&&!pcs.some(function(pc){return isOld(p.id,pc.id)}))return false;
    return true;
  });
}
function pieces(){
  var cat=$("#fCat").value,cr=$("#fCrit").checked;
  return S.pieces.filter(function(p){
    if(!inProc(p))return false;
    if(cat&&p.cat!==cat)return false;
    if(cr&&!p.crit)return false;
    return true;
  }).sort(function(a,b){return String(a.cat).localeCompare(String(b.cat))||a.id-b.id});
}

/* ------------- VISÃO GERAL ------------- */
function renderGeral(){
  var ppl=people(),pcs=pieces();
  var dn=$("#demoNote");dn.hidden=!S.cfg.demo;
  $("#demoOff").disabled=!canWrite();
  $("#vEyebrow").textContent="Leitura de hoje · processo "+S.proc;
  var cells=0,hits=0,sum=0,rated=0,old=0,dist=[0,0,0,0,0,0];
  ppl.forEach(function(p){var s=pStat(p,pcs);if(!s.n)return;
    rated++;hits+=s.hit;sum+=s.avg;cells+=s.n;old+=s.old;
    myPieces(p,pcs).forEach(function(pc){dist[getL(p.id,pc.id)]++})});
  var avg=rated?sum/rated:0,hitPct=cells?hits/cells*100:0;
  var risk=[],stop=0,orphan=0;
  pcs.forEach(function(pc){var st=cStat(pc,ppl);
    if(st.status==="n"){orphan++;return}
    if(st.status==="b"){risk.push({pc:pc,st:st});if(st.ready===0)stop++}});

  var t=$("#vTitle"),w=$("#vWhy");t.textContent="";
  if(!S.people.length||!S.pieces.length){
    t.textContent="A base ainda está vazia.";
    w.textContent="Comece pela tela Base de dados: cadastre quem solda e o que a célula solda. O resto do painel se monta sozinho.";
  }else if(!ppl.length||!pcs.length){
    t.textContent="Nenhuma linha com os filtros atuais.";
    w.textContent="Limpe um filtro para voltar a ver a célula.";
  }else if(risk.length){
    t.appendChild(document.createTextNode("A célula depende de pouca gente em "));
    t.appendChild(el("em",null,risk.length+(risk.length>1?" peças":" peça")));
    t.appendChild(document.createTextNode(" em "+S.proc+"."));
    w.textContent=stop?stop+(stop>1?" dessas peças não têm ninguém":" dessa peça não tem ninguém")+" no nível de meta. As outras sustentam a produção com uma pessoa só.":
      "Cada uma tem uma única pessoa no nível de meta em "+S.proc+". Uma falta e a peça para.";
  }else{
    t.appendChild(document.createTextNode("Toda peça tem pelo menos "));
    t.appendChild(el("em",null,"duas pessoas"));
    t.appendChild(document.createTextNode(" na meta em "+S.proc+"."));
    w.textContent="Nenhuma peça deste processo depende de um único soldador com os filtros atuais.";
  }

  var trio=$("#trio");trio.textContent="";
  [{n:Math.round(avg)+"%",t:"Domínio médio em "+S.proc,d:"média de cada um só nas peças que ele solda"},
   {n:Math.round(hitPct)+"%",t:"Chegou na meta",d:hits+" de "+cells+" avaliações atribuídas",k:cells&&hitPct<60?"alert":""},
   {n:String(risk.length),t:risk.length===1?"Peça em risco":"Peças em risco",d:orphan?"crítica com menos de 2 prontos · "+orphan+" sem ninguém atribuído":"crítica com menos de 2 pessoas prontas",k:risk.length?"danger":""},
   {n:String(old),t:"Avaliações vencidas",d:"mais de "+S.cfg.validade+" meses sem revisão",k:old?"alert":""}
  ].forEach(function(o){
    var d=el("div","stat"+(o.k?" "+o.k:""));
    d.appendChild(el("div","n",o.n));d.appendChild(el("div","t",o.t));d.appendChild(el("div","d",o.d));trio.appendChild(d);
  });

  var ramp=$("#ramp"),key=$("#rampkey");ramp.textContent="";key.textContent="";
  for(var i=1;i<=5;i++){(function(i){
    var share=cells?dist[i]/cells*100:0;
    var s=el("span",null,share>=7?Math.round(share)+"%":"");
    s.style.background="var(--l"+i+")";s.style.color="var(--l"+i+"fg)";
    s.title=i+". "+LV[i].t+" — "+dist[i]+" avaliações em "+S.proc;
    ramp.appendChild(s);requestAnimationFrame(function(){s.style.width=share+"%"});
    var k=el("div"),sw=el("span","sw");sw.style.background="var(--l"+i+")";
    k.appendChild(sw);k.appendChild(el("span",null,i+". "+LV[i].t.toLowerCase()+" · "+dist[i]));key.appendChild(k);
  })(i)}

  var todo=$("#todo");todo.textContent="";
  var semAsg=ppl.filter(function(p){return !myPieces(p,pcs).length});
  if(semAsg.length){
    var it0=el("div","it hot");
    it0.appendChild(el("div","rk","!"));
    var tx0=el("div","tx"),ln0=el("div");
    ln0.appendChild(el("b",null,"Definir o que "+semAsg.length+(semAsg.length>1?" pessoas soldam":" pessoa solda")+" em "+S.proc));
    tx0.appendChild(ln0);
    tx0.appendChild(el("span","s","Estão cadastradas mas sem nenhuma peça atribuída, então não entram em nenhum número do painel. Comece por "+first2(semAsg[0].name)+"."));
    it0.appendChild(tx0);
    var go=el("button","btn","Abrir perfil");go.type="button";
    go.onclick=function(){S.who=semAsg[0].id;setView("pessoa")};
    it0.appendChild(go);
    todo.appendChild(it0);
  }
  var acts=[];
  pcs.forEach(function(pc){
    var st=cStat(pc,ppl);if(st.status==="ok")return;
    if(st.status==="n"){acts.push({pc:pc,st:st,cand:null,score:(pc.crit?-1:9)});return}
    var cand=whoDoes(pc,ppl).map(function(p){return{p:p,L:getL(p.id,pc.id)}}).filter(function(x){return x.L<pc.goal})
      .sort(function(a,b){return b.L-a.L})[0];
    if(!cand)cand=ppl.filter(function(p){return !isAsg(p.id,pc.id)})
      .map(function(p){return{p:p,L:getL(p.id,pc.id),newly:true}}).sort(function(a,b){return b.L-a.L})[0];
    if(!cand)return;
    acts.push({pc:pc,st:st,cand:cand,score:(pc.crit?0:10)+st.ready*3+(pc.goal-cand.L)});
  });
  acts.sort(function(a,b){return a.score-b.score});
  if(!acts.length&&!semAsg.length)todo.appendChild(el("div","empty",S.people.length?"Nada pendente em "+S.proc+" com os filtros atuais.":"Cadastre a célula na Base de dados para ver o que fazer primeiro."));
  acts.slice(0,semAsg.length?4:6).forEach(function(a,i){
    var it=el("div","it"+(i<2?" hot":""));
    it.appendChild(el("div","rk",String(i+1)));
    var tx=el("div","tx"),line=el("div");
    if(a.st.status==="n"){
      line.appendChild(el("b",null,"Atribuir "+a.pc.name+" a alguém"));
      line.appendChild(document.createTextNode(" · "+S.proc+(a.pc.crit?" (peça crítica)":"")));
      tx.appendChild(line);
      tx.appendChild(el("span","s","Ninguém está marcado como quem solda esta peça neste processo."));
      it.appendChild(tx);it.appendChild(el("div","mv","sem responsável"));todo.appendChild(it);return;
    }
    line.appendChild(el("b",null,(a.cand.newly?"Habilitar ":"Treinar ")+first2(a.cand.p.name)));
    line.appendChild(document.createTextNode(" em "+a.pc.name+" · "+S.proc+(a.pc.crit?" (peça crítica)":"")));
    tx.appendChild(line);
    tx.appendChild(el("span","s",a.cand.newly?"Ele ainda não solda esta peça. É quem tem o nível mais alto entre os de fora.":
      a.st.ready===0?"Ninguém que solda esta peça atinge a meta. Ele é quem está mais perto.":
      "Hoje só "+a.st.ready+" pessoa sustenta a peça em "+S.proc+". Ele vira o segundo."));
    it.appendChild(tx);
    it.appendChild(el("div","mv","nível "+a.cand.L+" → "+a.pc.goal));
    todo.appendChild(it);
  });
  var rc=$("#riskCount");rc.textContent=String(risk.length);rc.hidden=risk.length===0;
}

/* ------------- MATRIZ ------------- */
var hiCol=null,matrixSig="",cellPaint=[],colIndex={},headIndex={};
function renderMatriz(){
  $("#lockM").textContent=S.proc;
  var tbl=$("#tbl"),ass=S.assign&&canWrite();
  tbl.classList.toggle("assign",ass);
  $("#scrollM").classList.toggle("assigning",ass);
  $("#aBanner").hidden=!ass;
  $("#assignHint").textContent=!canWrite()?"Acesso somente leitura: dá para ver tudo, mas não alterar.":
    ass?"Marcando quem solda o quê. Nenhum nível muda neste modo.":
    "Clique na pizza para mudar o nível. Shift+clique desce.";
  $("#pillAssign").style.display=canWrite()?"":"none";
  var ppl=people(),pcs=pieces();
  // A grade só é reconstruída quando a FORMA muda. Fora isso cada célula se
  // repinta sozinha, e só se o valor dela mudou — senão o botão sob o cursor
  // seria destruído no meio do clique e o navegador nem dispararia o evento.
  var sig=S.proc+"|"+(ass?"A":"N")+"|"+ppl.map(function(p){return p.id}).join(",")
         +"|"+pcs.map(function(p){return p.id+":"+p.goal+":"+(p.crit?1:0)+":"+p.name}).join(",");
  if(sig===matrixSig&&tbl.tBodies.length&&ppl.length&&pcs.length){
    for(var ci=0;ci<cellPaint.length;ci++)cellPaint[ci]();
    scores();return;
  }
  matrixSig=sig;cellPaint=[];colIndex={};headIndex={};
  tbl.textContent="";
  var th=el("thead"),cr=el("tr","cats");
  var h0=el("th","who");h0.rowSpan=2;h0.appendChild(el("span","eyebrow","Colaborador"));cr.appendChild(h0);
  var groups=[];
  pcs.forEach(function(pc){
    if(groups.length&&groups[groups.length-1].cat===pc.cat)groups[groups.length-1].n++;
    else groups.push({cat:pc.cat,n:1});
  });
  groups.forEach(function(gp,i){
    var c=el("th","cat"+(i?" sep":""));c.colSpan=gp.n;c.appendChild(el("span",null,gp.cat));cr.appendChild(c);
  });
  var he=el("th","end");he.rowSpan=2;he.appendChild(el("span","eyebrow","Na meta"));cr.appendChild(he);
  th.appendChild(cr);
  var hr=el("tr","heads");
  pcs.forEach(function(pc){
    var c=el("th","pc"+(pc.crit?" crit":""));c.dataset.i=String(pc.id);
    c.title=pc.name+" · "+pc.cat+(pc.crit?" · peça crítica":"")+" · meta nível "+pc.goal+" · processo "+S.proc
      +(pc.codes?"\n"+pc.codes+" códigos":"")+(pc.apps?"\nAplicações: "+pc.apps:"");
    c.appendChild(el("span","lbl",pc.name));c.appendChild(el("span","gl","meta "+pc.goal));
    headIndex[pc.id]=c;hr.appendChild(c);
  });
  th.appendChild(hr);tbl.appendChild(th);

  var tb=el("tbody");
  if(!ppl.length||!pcs.length){
    var tr0=el("tr"),td0=el("td");td0.colSpan=Math.max(1,pcs.length)+2;
    td0.appendChild(el("div","empty",S.people.length?"Nenhuma linha com os filtros atuais.":"Nenhum colaborador cadastrado ainda."));
    tr0.appendChild(td0);tb.appendChild(tr0);tbl.appendChild(tb);matrixSig="";return;
  }
  ppl.forEach(function(p){
    var tr=el("tr"),tw=el("td","who");
    tw.appendChild(el("div","nm",p.name));
    tw.appendChild(el("div","mt",[(p.chapa||"sem chapa"),
      p.role?String(p.role).replace("SOLDADOR ","SOLD."):"cargo —",
      p.turno?String(p.turno).split(" · ")[0]:"turno —"].join(" · ")));
    tr.appendChild(tw);
    pcs.forEach(function(pc){
      var td=el("td","c");td.dataset.i=String(pc.id);
      (colIndex[pc.id]=colIndex[pc.id]||[]).push(td);
      function draw(){
        var on0=isAsg(p.id,pc.id),n0=getL(p.id,pc.id),a0=S.assign&&canWrite();
        var key=(a0?"a":"v")+"|"+(on0?1:0)+"|"+n0+"|"+(isOld(p.id,pc.id)?1:0)+"|"+pc.goal;
        if(td.__k===key)return;            // nada mudou nesta célula: não toca no DOM
        td.__k=key;
        td.textContent="";td.classList.remove("below","old");
        var on=on0;
        if(a0){
          var t=el("button","tick"+(on?" on":""),on?"✓":"");t.type="button";
          t.title=p.name+(on?" solda ":" não solda ")+pc.name+" em "+S.proc+" — clique para "+(on?"tirar":"marcar");
          t.setAttribute("aria-label",p.name+", "+pc.name+" em "+S.proc+(on?", solda":", não solda"));
          t.setAttribute("aria-pressed",String(on));
          t.onclick=function(){toggleAsgW(p.id,pc.id);draw();scores();renderGeral()};
          td.appendChild(t);return;
        }
        if(!on){
          var na=el("button","na","–");na.type="button";
          na.title=p.name+" não solda "+pc.name+" em "+S.proc+(canWrite()?" — ligue o modo atribuição para mudar":"");
          na.setAttribute("aria-label",p.name+" não solda "+pc.name+" em "+S.proc);
          na.onclick=function(){
            if(!canWrite()){toast("Acesso somente leitura.");return}
            toast(first2(p.name)+" não solda "+pc.name+". Ligue o modo atribuição para mudar isso.");
          };
          td.appendChild(na);return;
        }
        var n=n0,bw=n<pc.goal;
        td.classList.toggle("below",bw);
        td.classList.toggle("old",isOld(p.id,pc.id));
        var b=el("button","hb "+(bw?"below":"ok"));b.type="button";
        b.appendChild(pie(n));
        b.title=pc.name+" · "+S.proc+" — nível "+n+": "+LV[n].t+" · meta "+pc.goal+" · "+ago(getTs(p.id,pc.id))+(canWrite()?" · clique sobe, shift+clique desce":"");
        b.setAttribute("aria-label",p.name+", "+pc.name+" em "+S.proc+", nível "+n+" "+LV[n].t);
        b.onclick=function(e){
          if(!canWrite()){toast("Acesso somente leitura.");return}
          var cur=getL(p.id,pc.id),nx=e.shiftKey?(cur<=1?5:cur-1):(cur>=5?1:cur+1);
          setLevel(p.id,pc.id,nx);repaintPie(nx);scores();
        };
        td.appendChild(b);
        // troca só a fatia, mantendo o MESMO botão sob o cursor
        function repaintPie(nx){
          var w=nx<pc.goal;
          td.__k="v|1|"+nx+"|"+(isOld(p.id,pc.id)?1:0)+"|"+pc.goal;
          b.className="hb "+(w?"below":"ok");
          td.classList.toggle("below",w);td.classList.toggle("old",isOld(p.id,pc.id));
          b.textContent="";b.appendChild(pie(nx));
          b.title=pc.name+" · "+S.proc+" — nível "+nx+": "+LV[nx].t+" · meta "+pc.goal+" · "+ago(getTs(p.id,pc.id))+" · clique sobe, shift+clique desce";
          b.setAttribute("aria-label",p.name+", "+pc.name+" em "+S.proc+", nível "+nx+" "+LV[nx].t);
        }
      }
      draw();cellPaint.push(draw);tr.appendChild(td);
    });
    var te=el("td","end");te.dataset.person=p.id;tr.appendChild(te);tb.appendChild(tr);
  });
  tbl.appendChild(tb);scores();

  function clearHi(){
    if(hiCol&&colIndex[hiCol])colIndex[hiCol].forEach(function(n){n.classList.remove("hi")});
    if(hiCol&&headIndex[hiCol])headIndex[hiCol].classList.remove("hi");
    hiCol=null;
  }
  tbl.onmouseover=function(e){
    var c=e.target.closest("td.c,th.pc");if(!c)return;
    var i=c.dataset.i;if(i===hiCol)return;
    clearHi();hiCol=i;
    if(colIndex[i])colIndex[i].forEach(function(n){n.classList.add("hi")});
    if(headIndex[i])headIndex[i].classList.add("hi");
  };
  tbl.onmouseleave=clearHi;

  var lg=$("#legend");lg.textContent="";
  for(var i=1;i<=5;i++){
    var d=el("div");d.appendChild(pieKey(i,20));
    d.appendChild(el("span",null,i+". "+LV[i].t.toLowerCase()+" · "+LV[i].pct+"%"));
    d.title=LV[i].d;lg.appendChild(d);
  }
}
function scores(){
  var pcs=pieces();
  document.querySelectorAll("td.end[data-person]").forEach(function(td){
    var p=byId(td.dataset.person);if(!p)return;
    var s=pStat(p,pcs);td.textContent="";
    var b=el("div","big",s.n?s.hit+"/"+s.n:"–");if(s.n&&s.hit<s.n)b.style.color="var(--yellow-deep)";
    td.appendChild(b);
    td.appendChild(el("div","sml",s.n?Math.round(s.avg)+"% em "+s.n+" peças":"sem peça atribuída"));
  });
}

/* ------------- COMPARATIVO ------------- */
function renderComp(){
  $("#lockC").textContent=S.proc;
  $("#lockCTxt").textContent="Todo gráfico desta tela usa só avaliações de "+S.proc+". "+(S.proc==="TW"?"SAW":"TW")+" tem escala própria e nunca entra na mesma conta — um nível 3 em TW não é comparável a um nível 5 em SAW.";
  document.querySelectorAll("#compTabs button").forEach(function(b){b.setAttribute("aria-pressed",String(b.dataset.c===S.comp))});
  var box=$("#compBody");box.textContent="";
  if(S.comp==="pessoas")compPessoas(box);
  else if(S.comp==="pecas")compPecas(box);
  else if(S.comp==="turnos")compTurnos(box);
  else compDuelo(box);
}
function mkEmpty(t){var d=el("div","list");d.style.marginTop="12px";d.appendChild(el("div","empty",t));return d}
function compPessoas(box){
  var ppl=people(),pcs=pieces();
  if(!ppl.length||!pcs.length){box.appendChild(mkEmpty("Sem dados para comparar com os filtros atuais."));return}
  var rows=ppl.map(function(p){return{p:p,s:pStat(p,pcs)}}).filter(function(r){return r.s.n})
    .sort(function(a,b){return b.s.avg-a.s.avg});
  if(!rows.length){box.appendChild(mkEmpty("Ninguém tem peça atribuída em "+S.proc+" ainda."));return}
  var media=rows.reduce(function(a,r){return a+r.s.avg},0)/rows.length;
  var head=el("div","card pad");
  head.appendChild(el("span","eyebrow","Domínio por pessoa · só "+S.proc));
  var hp=el("p",null,"Barra = média do % das peças que cada um solda em "+S.proc+". O risco preto marca a média da equipe ("+Math.round(media)+"%).");
  hp.style.cssText="margin:6px 0 0;font-size:12.5px;color:var(--ink-2)";head.appendChild(hp);
  box.appendChild(head);
  var list=el("div","list");list.style.marginTop="12px";
  rows.forEach(function(r){
    var li=el("div","li"),h=el("div","h");h.appendChild(el("span",null,r.p.name));li.appendChild(h);
    var mid=el("div");mid.style.minWidth="0";
    var tk=el("div","track"),i=el("i");if(r.s.avg<media)i.className="w";
    tk.appendChild(i);var u=el("u");u.style.left=media+"%";tk.appendChild(u);mid.appendChild(tk);
    var sub=el("div",null,[r.p.role||"cargo —",(r.p.turno?String(r.p.turno).split(" · ")[0]:"turno —"),
      r.s.hit+" de "+r.s.n+" peças na meta"].join(" · ")+(r.s.old?" · "+r.s.old+" vencidas":""));
    sub.style.cssText="font-size:11.5px;color:var(--ink-2);margin-top:6px";mid.appendChild(sub);li.appendChild(mid);
    var rr=el("div","right");rr.appendChild(el("b",Math.round(r.s.avg)+"%"));li.appendChild(rr);
    list.appendChild(li);requestAnimationFrame(function(){i.style.width=r.s.avg+"%"});
  });
  box.appendChild(list);
}
function compPecas(box){
  var ppl=people(),pcs=pieces();
  if(!ppl.length||!pcs.length){box.appendChild(mkEmpty("Sem dados para comparar com os filtros atuais."));return}
  var head=el("div","card pad");
  head.appendChild(el("span","eyebrow","Cobertura por peça · só "+S.proc));
  var hp=el("p",null,"Barra = quantos dos que soldam a peça em "+S.proc+" atingem a meta dela.");
  hp.style.cssText="margin:6px 0 0;font-size:12.5px;color:var(--ink-2)";head.appendChild(hp);
  box.appendChild(head);
  var list=el("div","list");list.style.marginTop="12px";
  pcs.map(function(pc){return{pc:pc,st:cStat(pc,ppl)}}).sort(function(a,b){return a.st.ready-b.st.ready})
   .forEach(function(o){
    var li=el("div","li"),h=el("div","h");
    h.appendChild(el("span",null,o.pc.name));
    if(o.pc.crit)h.appendChild(el("span","chip crit","CRÍTICA"));
    li.appendChild(h);
    var mid=el("div");mid.style.minWidth="0";
    var top=el("div");top.style.cssText="display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:7px;flex-wrap:wrap";
    var lf=el("div");lf.style.cssText="display:flex;gap:6px;flex-wrap:wrap;min-width:0";
    lf.appendChild(el("span","chip cat",o.pc.cat+" · meta "+o.pc.goal));
    if(o.pc.codes)lf.appendChild(el("span","chip cat",o.pc.codes+" códigos"));
    if(o.pc.apps)lf.appendChild(el("span","chip cat",o.pc.apps));
    top.appendChild(lf);
    top.appendChild(el("span","state "+o.st.status,
      o.st.status==="n"?"ninguém atribuído":o.st.ready===0?"ninguém pronto":
      o.st.status==="b"?"risco de parada":o.st.status==="w"?"margem curta":"coberta"));
    mid.appendChild(top);
    var tk=el("div","track"),i=el("i");
    if(o.st.status==="b"||o.st.status==="n")i.className="b";else if(o.st.status==="w")i.className="w";
    tk.appendChild(i);mid.appendChild(tk);li.appendChild(mid);
    var rr=el("div","right");rr.appendChild(el("b",String(o.st.ready)));
    rr.appendChild(document.createTextNode(" de "+o.st.total+" que soldam"));li.appendChild(rr);
    list.appendChild(li);
    requestAnimationFrame(function(){i.style.width=(o.st.total?o.st.ready/o.st.total*100:0)+"%"});
  });
  box.appendChild(list);
}
function compTurnos(box){
  var ppl=people(),pcs=pieces();
  if(!ppl.length||!pcs.length){box.appendChild(mkEmpty("Sem dados para comparar com os filtros atuais."));return}
  var map={};ppl.forEach(function(p){var t=p.turno||"Sem turno · não informado";(map[t]=map[t]||[]).push(p)});
  var head=el("div","card pad");
  head.appendChild(el("span","eyebrow","Turno contra turno · só "+S.proc));
  var hp=el("p",null,"Cada turno é avaliado contra as mesmas peças e as mesmas metas, dentro de "+S.proc+".");
  hp.style.cssText="margin:6px 0 0;font-size:12.5px;color:var(--ink-2)";head.appendChild(hp);
  box.appendChild(head);
  var list=el("div","list");list.style.marginTop="12px";
  Object.keys(map).sort().forEach(function(tn){
    var gp=map[tn],sum=0,hits=0,cells=0,rated=0;
    gp.forEach(function(p){var s=pStat(p,pcs);if(!s.n)return;rated++;sum+=s.avg;hits+=s.hit;cells+=s.n});
    var avg=rated?sum/rated:0,dead=0;
    pcs.forEach(function(pc){if(cStat(pc,gp).ready===0)dead++});
    var li=el("div","li"),h=el("div","h");
    h.appendChild(el("span",null,String(tn).split(" · ")[0]));
    h.appendChild(el("span","chip cat",(String(tn).split(" · ")[1]||"turno")+" · "+gp.length+(gp.length>1?" pessoas":" pessoa")));
    li.appendChild(h);
    var mid=el("div");mid.style.minWidth="0";
    var tk=el("div","track"),i=el("i");if(dead)i.className="b";
    tk.appendChild(i);mid.appendChild(tk);
    var sub=el("div",null,hits+" de "+cells+" avaliações na meta"+(dead?" · "+dead+(dead>1?" peças sem ninguém":" peça sem ninguém")+" pronto neste turno":" · todas as peças têm alguém pronto"));
    sub.style.cssText="font-size:11.5px;color:"+(dead?"var(--red)":"var(--ink-2)")+";margin-top:6px";
    mid.appendChild(sub);li.appendChild(mid);
    var rr=el("div","right");rr.appendChild(el("b",Math.round(avg)+"%"));
    rr.appendChild(document.createTextNode(" domínio"));li.appendChild(rr);
    list.appendChild(li);requestAnimationFrame(function(){i.style.width=avg+"%"});
  });
  box.appendChild(list);
}
function compDuelo(box){
  var pcs=pieces();
  var ctl=el("div","card pad");
  ctl.appendChild(el("span","eyebrow","Dois a dois · mesma peça, mesmo processo"));
  var row=el("div","bar");row.style.marginTop="10px";
  var sa=el("select","inp"),sb=el("select","inp");
  S.people.forEach(function(p){
    var o=el("option",null,p.name);o.value=p.id;sa.appendChild(o);
    var o2=el("option",null,p.name);o2.value=p.id;sb.appendChild(o2);
  });
  if(!S.duelA&&S.people[0])S.duelA=S.people[0].id;
  if(!S.duelB&&S.people[1])S.duelB=S.people[1].id;
  sa.value=S.duelA||"";sb.value=S.duelB||"";
  sa.setAttribute("aria-label","Primeira pessoa");sb.setAttribute("aria-label","Segunda pessoa");
  sa.onchange=function(){S.duelA=sa.value;renderComp()};
  sb.onchange=function(){S.duelB=sb.value;renderComp()};
  row.appendChild(sa);row.appendChild(el("span",null,"contra"));row.appendChild(sb);
  ctl.appendChild(row);box.appendChild(ctl);

  var A=byId(S.duelA),B=byId(S.duelB);
  if(!A||!B||!pcs.length){box.appendChild(mkEmpty("Escolha duas pessoas para comparar."));return}
  if(A.id===B.id){box.appendChild(mkEmpty("Escolha duas pessoas diferentes."));return}
  var both=pcs.filter(function(pc){return isAsg(A.id,pc.id)&&isAsg(B.id,pc.id)});
  var fora=pcs.length-both.length;
  if(!both.length){box.appendChild(mkEmpty("Os dois não têm nenhuma peça em comum em "+S.proc+". Só dá para comparar peça que os dois soldam."));return}
  var wa=0,wb=0,tie=0;
  both.forEach(function(pc){var a=getL(A.id,pc.id),b=getL(B.id,pc.id);if(a>b)wa++;else if(b>a)wb++;else tie++});
  var sum=el("div","card pad");sum.style.marginTop="12px";
  var st=el("p",null,first2(A.name)+" está à frente em "+wa+(wa===1?" peça":" peças")+", "+first2(B.name)+" em "+wb+", e empatam em "+tie+" — nas "+both.length+" peças que os dois soldam em "+S.proc+".");
  st.style.cssText="margin:0;font-size:13.5px";sum.appendChild(st);
  if(fora){var f=el("p","hint",fora+(fora===1?" peça ficou de fora":" peças ficaram de fora")+" porque só um dos dois solda.");
    f.style.marginTop="6px";sum.appendChild(f)}
  box.appendChild(sum);
  var list=el("div","list");list.style.marginTop="12px";
  both.forEach(function(pc){
    var a=getL(A.id,pc.id),b=getL(B.id,pc.id);
    var d=el("div","duel"+(a>b?" winL":b>a?" winR":""));
    var l=el("div","side");l.appendChild(pieKey(a,22,a<pc.goal));l.appendChild(el("span","lv","nível "+a));d.appendChild(l);
    var c=el("div","pcn",pc.name);c.appendChild(el("small",null,"meta "+pc.goal));d.appendChild(c);
    var r=el("div","side r");r.appendChild(el("span","lv","nível "+b));r.appendChild(pieKey(b,22,b<pc.goal));d.appendChild(r);
    list.appendChild(d);
  });
  box.appendChild(list);
}

/* ------------- RISCOS ------------- */
function renderRiscos(){
  $("#lockR").textContent=S.proc;
  var ppl=people(),pcs=pieces(),box=$("#riskList");box.textContent="";
  var l=pcs.map(function(pc){return{pc:pc,st:cStat(pc,ppl)}}).filter(function(o){return o.st.status!=="ok"})
    .sort(function(a,b){return a.st.ready-b.st.ready||(b.pc.crit?1:0)-(a.pc.crit?1:0)});
  if(!l.length){box.appendChild(el("div","empty",pcs.length?"Nenhuma peça em risco em "+S.proc+".":"Nenhuma peça cadastrada para este processo."));return}
  l.forEach(function(o){
    var r=el("div","li"),h=el("div","h");
    h.appendChild(el("span",null,o.pc.name));
    if(o.pc.crit)h.appendChild(el("span","chip crit","CRÍTICA"));
    r.appendChild(h);
    var mid=el("div");mid.style.minWidth="0";
    var p1=el("div",null,
      o.st.status==="n"?"Ninguém está marcado como quem solda esta peça em "+S.proc+".":
      o.st.ready===0?"Ninguém que solda esta peça chega ao nível "+o.pc.goal+" em "+S.proc+".":
      "Só "+o.st.ready+" pessoa sustenta esta peça em "+S.proc+". Uma ausência e ela para.");
    p1.style.fontSize="13px";mid.appendChild(p1);
    var near=whoDoes(o.pc,ppl).map(function(p){return{p:p,L:getL(p.id,o.pc.id)}}).filter(function(x){return x.L<o.pc.goal})
      .sort(function(a,b){return b.L-a.L}).slice(0,2);
    if(near.length){
      var p2=el("div",null,"Mais perto: "+near.map(function(x){return first2(x.p.name)+" (nível "+x.L+")"}).join(" · "));
      p2.style.cssText="font-size:12px;color:var(--ink-2);margin-top:3px";mid.appendChild(p2);
    }
    r.appendChild(mid);
    var rr=el("div","right");rr.appendChild(el("b",o.st.ready+"/"+o.st.total));
    rr.appendChild(document.createTextNode(o.st.status==="n"?" atribuídos":" na meta "+o.pc.goal));
    r.appendChild(rr);box.appendChild(r);
  });
}

/* ------------- PESSOA ------------- */
function renderPessoa(){
  var pcs=pieces();
  var p=byId(S.who)||S.people[0];
  var head=$("#whoHead"),bar=$("#asgBar"),gg=$("#gapGrid"),lg=$("#logList");
  head.textContent="";bar.textContent="";gg.textContent="";lg.textContent="";
  if(!p){head.appendChild(el("div","hint","Nenhum colaborador cadastrado. Comece pela Base de dados."));return}
  S.who=p.id;
  var s=pStat(p,pcs);
  var a=String(p.name).trim().split(/\s+/);
  head.appendChild(el("div","av",(a[0]||"?")[0]+(a[1]?a[1][0]:"")));
  var info=el("div");info.style.minWidth="0";
  var sel=el("select","whosel");sel.setAttribute("aria-label","Trocar colaborador");
  S.people.forEach(function(x){var o=el("option",null,x.name);o.value=x.id;sel.appendChild(o)});
  sel.value=p.id;sel.onchange=function(){S.who=sel.value;renderPessoa()};
  info.appendChild(sel);
  info.appendChild(el("div","mt","Chapa "+(p.chapa||"—")+" · "+(p.role||"cargo não informado")+" · "+(p.turno||"turno não informado")+" · F30 CALDEIRARIA"));
  head.appendChild(info);
  var sp=el("div");sp.style.flex="1 1 auto";head.appendChild(sp);
  var sc=el("div");sc.style.textAlign="right";
  var n=el("div",null,s.n?Math.round(s.avg)+"%":"–");n.style.cssText="font-family:var(--disp);font-size:30px;font-weight:800;line-height:1";
  sc.appendChild(n);sc.appendChild(el("div","sml",s.n?s.hit+" de "+s.n+" peças na meta em "+S.proc:"sem peça atribuída em "+S.proc));
  head.appendChild(sc);

  var mine=myPieces(p,pcs);
  if(!canWrite()){
    bar.appendChild(el("span","hint","Acesso somente leitura: "+mine.length+" de "+pcs.length+" peças de "+S.proc+" estão atribuídas a ele."));
  }else if(S.assign){
    var done=el("button","btn","Concluir seleção");done.type="button";
    done.onclick=function(){setAssign(false);renderAll();
      toast(first2(p.name)+": "+myPieces(p,pieces()).length+" peças em "+S.proc)};
    bar.appendChild(done);
    var all=el("button","btn sec","Marcar todas");all.type="button";
    all.onclick=function(){setAllAsgW(p.id,true);renderPessoa();renderGeral()};
    var none=el("button","btn sec","Desmarcar todas");none.type="button";
    none.onclick=function(){
      if(none.dataset.armed!=="1"){
        none.dataset.armed="1";none.className="btn warn";
        none.textContent="Confirmar: tirar as "+mine.length+" peças";
        setTimeout(function(){if(none.dataset.armed==="1"){none.dataset.armed="";none.className="btn sec";none.textContent="Desmarcar todas"}},4000);
        return;
      }
      setAllAsgW(p.id,false);renderPessoa();renderGeral();toast("Peças de "+first2(p.name)+" em "+S.proc+" retiradas");
    };
    bar.appendChild(all);bar.appendChild(none);
    bar.appendChild(el("span","hint","Clique numa peça para marcar ou tirar. Ao concluir, só as peças que ele solda continuam na tela."));
  }else{
    var edit=el("button","btn","Escolher as peças que ele solda");edit.type="button";
    edit.onclick=function(){setAssign(true);renderPessoa()};
    bar.appendChild(edit);
    bar.appendChild(el("span","hint",mine.length+" de "+pcs.length+" peças de "+S.proc+" atribuídas. O que não está atribuído não entra na conta dele."));
  }

  var list=(S.assign&&canWrite())?pcs.slice():mine.slice();
  var below=mine.filter(function(pc){return getL(p.id,pc.id)<pc.goal}).length;
  $("#gapEyebrow").textContent=(S.assign&&canWrite())
    ?"Escolhendo peças · "+S.proc+" · "+mine.length+" marcadas de "+pcs.length
    :"Peças que ele solda em "+S.proc+" · "+mine.length+(below?" · "+below+" abaixo da meta":(mine.length?" · todas na meta":""));
  if(!list.length){
    var w=el("div","card");w.style.gridColumn="1/-1";
    w.appendChild(el("div","empty",(S.assign&&canWrite())?"Nenhuma peça cadastrada para este processo.":"Nenhuma peça atribuída a ele em "+S.proc+"."));
    gg.appendChild(w);
  }else{
    list.sort(function(x,y){
      var lx=getL(p.id,x.id),ly=getL(p.id,y.id);
      return (lx-x.goal)-(ly-y.goal)||(y.crit?1:0)-(x.crit?1:0)||String(x.name).localeCompare(String(y.name));
    }).forEach(function(pc){
      var on=isAsg(p.id,pc.id),L=getL(p.id,pc.id),bw=on&&L<pc.goal,od=on&&isOld(p.id,pc.id);
      var d=el("button","pcard"+(on?((bw?" below":"")+(od?" old":"")):" off"));d.type="button";
      var pk=pieKey(L,24,bw);
      if(!S.assign&&on&&canWrite()){
        pk.style.cursor="pointer";pk.title="Clique para mudar o nível";
        pk.onclick=function(e){e.stopPropagation();setLevel(p.id,pc.id,L>=5?1:L+1);renderPessoa();renderGeral()};
      }
      d.appendChild(pk);
      var t=el("div","t");
      t.appendChild(el("b",null,pc.name));
      var sub=el("span",null,on?("nível "+L+" · meta "+pc.goal+" · "+ago(getTs(p.id,pc.id))):"não solda");
      if(od)sub.className="exp";
      t.appendChild(sub);d.appendChild(t);
      d.onclick=function(){
        if(!canWrite()){toast("Acesso somente leitura.");return}
        if(!S.assign){toast("Clique em escolher as peças para mudar isso");return}
        toggleAsgW(p.id,pc.id);renderPessoa();renderGeral();
      };
      gg.appendChild(d);
    });
  }

  lg.appendChild(el("div","empty","Carregando histórico…"));
  SB.from("audit").select("at,actor_email,piece_id,proc,kind,from_level,to_level,note")
    .eq("person_id",p.id).eq("proc",S.proc).order("at",{ascending:false}).limit(20)
    .then(function(r){
      if(S.view!=="pessoa"||S.who!==p.id)return;
      lg.textContent="";
      var rows=(r.data||[]);
      if(r.error){lg.appendChild(el("div","empty","Não consegui ler o histórico agora."));return}
      if(!rows.length){lg.appendChild(el("div","empty","Nenhuma alteração registrada para "+first2(p.name)+" em "+S.proc+" ainda."));return}
      rows.forEach(function(e){
        var row=el("div","logrow");
        row.appendChild(el("div","w",dstr(new Date(e.at).getTime())));
        var pc=S.pieces.filter(function(x){return x.id===e.piece_id})[0];
        var txt;
        if(e.kind==="nivel")txt=(pc?pc.name:"peça")+": nível "+e.from_level+" → "+e.to_level;
        else if(e.kind==="atribuir")txt=(pc?pc.name:"peça")+": passou a soldar";
        else if(e.kind==="tirar")txt=(pc?pc.name:"peça")+": deixou de soldar";
        else txt=e.note||"alteração em lote";
        row.appendChild(el("div",null,txt));
        row.appendChild(el("div","who2",e.actor_email||"—"));
        lg.appendChild(row);
      });
    });
}

/* ------------- BASE ------------- */
function renderBase(){
  document.querySelectorAll("#baseTabs button").forEach(function(b){b.setAttribute("aria-pressed",String(b.dataset.b===S.baseTab))});
  var box=$("#baseBody");box.textContent="";
  if(!canWrite()){
    var n=el("div","note","Seu acesso a este painel é somente leitura. Você vê a base inteira, mas não consegue alterar.");
    n.style.marginBottom="14px";box.appendChild(n);
  }
  if(S.baseTab==="pessoas")basePessoas(box);
  else if(S.baseTab==="pecas")basePecas(box);
  else baseConfig(box);
}
function basePessoas(box){
  var card=el("div","card"),hd=el("div","pad");
  hd.style.borderBottom="1px solid var(--line)";
  hd.appendChild(el("span","eyebrow","Colaboradores · "+S.people.length));
  var hp=el("p",null,"Quem está na célula. Cada pessoa vira uma linha da matriz, nos dois processos.");
  hp.style.cssText="margin:6px 0 0;font-size:12.5px;color:var(--ink-2)";hd.appendChild(hp);
  card.appendChild(hd);
  var wrap=el("div","dbwrap"),t=el("table","dbtable"),th=el("thead"),hr=el("tr");
  ["Chapa","Nome","Cargo","Turno","Peças que solda",""].forEach(function(x){hr.appendChild(el("th",null,x))});
  th.appendChild(hr);t.appendChild(th);
  var tb=el("tbody");
  S.people.forEach(function(p){
    var tr=el("tr");
    [["chapa",108],["name",0],["role",148],["turno",156]].forEach(function(f){
      var td=el("td"),inp=el("input");inp.type="text";inp.value=p[f[0]]||"";
      if(f[1])td.style.width=f[1]+"px";
      inp.disabled=!canWrite();
      inp.oninput=function(){p[f[0]]=inp.value};
      inp.onchange=function(){savePerson(p);refreshFilters()};
      td.appendChild(inp);tr.appendChild(td);
    });
    var tdA=el("td");tdA.style.width="150px";
    var open=el("button","btn del","TW "+countAsg(p.id,"TW")+" · SAW "+countAsg(p.id,"SAW"));
    open.type="button";open.title="Abrir o perfil para escolher as peças";
    open.onclick=function(){S.who=p.id;setView("pessoa")};
    tdA.appendChild(open);tr.appendChild(tdA);
    var td=el("td");td.style.width="62px";
    var b=el("button","btn del","Excluir");b.type="button";b.disabled=!canWrite();
    b.onclick=function(){delPerson(p);refreshFilters();renderBase();renderAll();toast("Colaborador removido")};
    td.appendChild(b);tr.appendChild(td);tb.appendChild(tr);
  });
  t.appendChild(tb);wrap.appendChild(t);card.appendChild(wrap);
  var ft=el("div","pad");ft.style.borderTop="1px solid var(--line)";
  var add=el("button","btn","Adicionar colaborador");add.type="button";add.disabled=!canWrite();
  add.onclick=function(){
    var p={id:newPid(),chapa:"",name:"NOVO COLABORADOR",role:"SOLDADOR I",turno:"ADM3 · Diurno"};
    S.people.push(p);savePerson(p);renderBase();toast("Linha adicionada — preencha a chapa e o nome")};
  ft.appendChild(add);card.appendChild(ft);
  box.appendChild(card);
  box.appendChild(bulkCard());
  box.appendChild(importCard("pessoas"));
}

var BULK={sel:null,scope:"all",mode:"on",busy:false};
function bulkCard(){
  var pcs=S.pieces.filter(inProc);
  if(BULK.sel===null){BULK.sel={};pcs.forEach(function(p){BULK.sel[p.id]=1})}
  var card=el("div","card pad");card.style.marginTop="14px";
  card.appendChild(el("span","eyebrow","Atribuir peças em massa · processo "+S.proc));
  var h=el("p","hint","Com a célula inteira cadastrada, marcar peça por peça não termina nunca. Escolha as peças, escolha quem recebe e aplique de uma vez. Vale só para "+S.proc+" — o outro processo tem a atribuição dele.");
  h.style.marginTop="7px";card.appendChild(h);

  var chips=el("div","pchips");
  pcs.forEach(function(p){
    var c=el("button","pchip"+(BULK.sel[p.id]?" on":"")+(p.crit?" crit":""),p.name);
    c.type="button";c.disabled=!canWrite();
    c.onclick=function(){
      if(BULK.sel[p.id])delete BULK.sel[p.id];else BULK.sel[p.id]=1;
      c.classList.toggle("on",!!BULK.sel[p.id]);
    };
    chips.appendChild(c);
  });
  card.appendChild(chips);

  var row1=el("div","bar");row1.style.marginTop="11px";
  [["Todas",function(){BULK.sel={};pcs.forEach(function(p){BULK.sel[p.id]=1});renderBase()}],
   ["Nenhuma",function(){BULK.sel={};renderBase()}],
   ["Só críticas",function(){BULK.sel={};pcs.forEach(function(p){if(p.crit)BULK.sel[p.id]=1});renderBase()}]
  ].forEach(function(o){
    var b=el("button","btn sec",o[0]);b.type="button";b.disabled=!canWrite();b.onclick=o[1];row1.appendChild(b);
  });
  card.appendChild(row1);

  var row2=el("div","bar");row2.style.marginTop="11px";
  var filtered=people().length;
  var sc=el("select","inp");sc.disabled=!canWrite();sc.setAttribute("aria-label","Quem recebe");
  [["all","Todos os "+S.people.length+" colaboradores"],["filter","Só os "+filtered+" do filtro atual"]]
    .forEach(function(o){var x=el("option",null,o[1]);x.value=o[0];sc.appendChild(x)});
  sc.value=BULK.scope;sc.onchange=function(){BULK.scope=sc.value};
  row2.appendChild(sc);
  var md=el("select","inp");md.disabled=!canWrite();md.setAttribute("aria-label","Ação");
  [["on","Marcar como quem solda"],["off","Tirar essas peças"]]
    .forEach(function(o){var x=el("option",null,o[1]);x.value=o[0];md.appendChild(x)});
  md.value=BULK.mode;md.onchange=function(){BULK.mode=md.value};
  row2.appendChild(md);
  var ap=el("button","btn","Aplicar");ap.type="button";ap.disabled=!canWrite()||BULK.busy;
  card.appendChild(row2);
  row2.appendChild(ap);

  var prog=el("div","prog");prog.hidden=true;var pi=el("i");prog.appendChild(pi);card.appendChild(prog);
  var st=el("p","hint");st.style.marginTop="8px";st.hidden=true;card.appendChild(st);

  ap.onclick=function(){
    if(!requireWrite())return;
    var sel=Object.keys(BULK.sel).filter(function(k){return BULK.sel[k]}).map(Number);
    if(!sel.length){toast("Escolha ao menos uma peça");return}
    var targets=(BULK.scope==="filter"?people():S.people).slice();
    if(!targets.length){toast("Nenhum colaborador no alvo escolhido");return}
    BULK.busy=true;ap.disabled=true;prog.hidden=false;st.hidden=false;
    var proc=S.proc,on=BULK.mode==="on",changed=0;
    targets.forEach(function(p){
      var d=g(p.id),touched=false;
      d.asg=d.asg||{};
      sel.forEach(function(id){
        if(on){if(!d.asg[id]){d.asg[id]=1;if(!d.ts[id])d.ts[id]=Date.now();touched=true}}
        else if(d.asg[id]){delete d.asg[id];touched=true}
      });
      if(touched)changed++;
      p._bulk=touched;
    });
    var list=targets.filter(function(p){return p._bulk});
    if(!list.length){
      BULK.busy=false;prog.hidden=true;st.hidden=true;ap.disabled=false;
      toast("Nada mudou: essas peças já estavam assim.");return;
    }
    // grava em lotes: uma ida ao banco por grupo de colaboradores
    var rows=[],agora=new Date().toISOString();
    list.forEach(function(p){
      var d=S.grid[gk(p.id,proc)];
      sel.forEach(function(id){
        rows.push({person_id:p.id,piece_id:Number(id),proc:proc,
          assigned:on,level:d.lv[id]||1,
          rated_at:new Date(d.ts[id]||Date.now()).toISOString(),
          updated_at:agora,updated_by:S.uid});
      });
    });
    var LOTE=400,i=0;
    function step(){
      pi.style.width=Math.round(i/rows.length*100)+"%";
      st.textContent="Gravando "+Math.min(i,rows.length)+" de "+rows.length+" lançamentos…";
      if(i>=rows.length){
        BULK.busy=false;
        logAudit(list.map(function(p){return {person_id:p.id,proc:proc,kind:"lote",
          note:(on?"atribuídas ":"retiradas ")+sel.length+" peças em massa"}}));
        toast((on?"Peças atribuídas a ":"Peças retiradas de ")+list.length+" colaboradores em "+proc);
        renderBase();renderAll();return;
      }
      var chunk=rows.slice(i,i+LOTE);i+=LOTE;
      SB.from("levels").upsert(chunk,{onConflict:"person_id,piece_id,proc"}).then(function(r){
        if(r.error){erro(r.error);BULK.busy=false;prog.hidden=true;st.hidden=true;ap.disabled=false;return}
        step();
      });
    }
    step();
  };
  return card;
}
function basePecas(box){
  var card=el("div","card"),hd=el("div","pad");
  hd.style.borderBottom="1px solid var(--line)";
  hd.appendChild(el("span","eyebrow","Peças · "+S.pieces.length));
  var hp=el("p",null,"O que a célula solda. Meta é o nível exigido, crítica marca a peça que para a linha, processo define se ela aparece em TW, SAW ou nos dois.");
  hp.style.cssText="margin:6px 0 0;font-size:12.5px;color:var(--ink-2)";hd.appendChild(hp);
  card.appendChild(hd);
  var wrap=el("div","dbwrap"),t=el("table","dbtable"),th=el("thead"),hr=el("tr");
  ["Peça","Linha / categoria","Códigos","Aplicações","Meta","Crítica","Processo",""].forEach(function(x){hr.appendChild(el("th",null,x))});
  th.appendChild(hr);t.appendChild(th);
  var tb=el("tbody");
  S.pieces.slice().sort(function(a,b){return a.id-b.id}).forEach(function(pc){
    var tr=el("tr");
    [["name",0],["cat",176]].forEach(function(f){
      var td=el("td"),inp=el("input");inp.type="text";inp.value=pc[f[0]]||"";
      if(f[1])td.style.width=f[1]+"px";
      inp.disabled=!canWrite();
      inp.oninput=function(){pc[f[0]]=inp.value};
      inp.onchange=function(){savePiece(pc);refreshFilters();renderAll()};
      td.appendChild(inp);tr.appendChild(td);
    });
    var tdN=el("td");tdN.style.width="86px";
    var inN=el("input");inN.type="text";inN.value=pc.codes?String(pc.codes):"";
    inN.disabled=!canWrite();inN.style.fontFamily="var(--mono)";
    inN.oninput=function(){pc.codes=Number(inN.value.replace(/\D/g,""))||0};
    inN.onchange=function(){savePiece(pc);renderAll()};
    tdN.appendChild(inN);tr.appendChild(tdN);
    var tdA=el("td");tdA.style.width="230px";
    var inA=el("input");inA.type="text";inA.value=pc.apps||"";inA.disabled=!canWrite();
    inA.oninput=function(){pc.apps=inA.value};
    inA.onchange=function(){savePiece(pc)};
    tdA.appendChild(inA);tr.appendChild(tdA);
    var tdG=el("td");tdG.style.width="76px";
    var sg=el("select");sg.disabled=!canWrite();
    for(var n=1;n<=5;n++){var o=el("option",null,String(n));o.value=String(n);sg.appendChild(o)}
    sg.value=String(pc.goal);
    sg.onchange=function(){pc.goal=Number(sg.value);savePiece(pc);renderAll()};
    tdG.appendChild(sg);tr.appendChild(tdG);
    var tdC=el("td");tdC.style.width="68px";
    var ck=el("input");ck.type="checkbox";ck.checked=!!pc.crit;ck.disabled=!canWrite();
    ck.onchange=function(){pc.crit=ck.checked;savePiece(pc);renderAll()};
    tdC.appendChild(ck);tr.appendChild(tdC);
    var tdP=el("td");tdP.style.width="106px";
    var sp=el("select");sp.disabled=!canWrite();
    ["AMBOS","TW","SAW"].forEach(function(v){var o=el("option",null,v==="AMBOS"?"TW e SAW":v);o.value=v;sp.appendChild(o)});
    sp.value=pc.procs||"AMBOS";
    sp.onchange=function(){pc.procs=sp.value;savePiece(pc);renderAll()};
    tdP.appendChild(sp);tr.appendChild(tdP);
    var tdX=el("td");tdX.style.width="62px";
    var b=el("button","btn del","Excluir");b.type="button";b.disabled=!canWrite();
    b.onclick=function(){delPiece(pc);refreshFilters();renderBase();renderAll();toast("Peça removida")};
    tdX.appendChild(b);tr.appendChild(tdX);tb.appendChild(tr);
  });
  t.appendChild(tb);wrap.appendChild(t);card.appendChild(wrap);
  var ft=el("div","pad");ft.style.borderTop="1px solid var(--line)";
  var add=el("button","btn","Adicionar peça");add.type="button";add.disabled=!canWrite();
  add.onclick=function(){
    var pc={id:nextPieceId(),name:"NOVA PEÇA",cat:"Componentes & Caldeiraria",crit:false,goal:3,procs:"AMBOS"};
    S.pieces.push(pc);savePiece(pc);refreshFilters();renderBase();renderAll();toast("Peça adicionada")};
  ft.appendChild(add);card.appendChild(ft);
  box.appendChild(card);
  box.appendChild(importCard("pecas"));
}
function baseConfig(box){
  var card=el("div","card pad");
  card.appendChild(el("span","eyebrow","Validade da avaliação"));
  var hp=el("p",null,"Uma matriz sem data de revisão apodrece: em poucos meses ninguém confia mais no número. Passado o prazo abaixo, a avaliação é marcada como vencida na matriz, no perfil e na visão geral.");
  hp.style.cssText="margin:7px 0 12px;font-size:12.5px;color:var(--ink-2);max-width:70ch";card.appendChild(hp);
  var row=el("div","bar");
  var sel=el("select","inp");sel.disabled=!canWrite();sel.setAttribute("aria-label","Validade em meses");
  [3,6,9,12,18,24].forEach(function(m){var o=el("option",null,m+" meses");o.value=String(m);sel.appendChild(o)});
  sel.value=String(S.cfg.validade);
  sel.onchange=function(){S.cfg.validade=Number(sel.value);saveCfg();renderAll();toast("Validade: "+S.cfg.validade+" meses")};
  row.appendChild(sel);
  card.appendChild(row);
  box.appendChild(card);

  var who=el("div","card pad");who.style.marginTop="14px";
  who.appendChild(el("span","eyebrow","Quem pode mudar o quê"));
  var p1=el("p",null,"O acesso é por conta de usuário no Supabase. Sem login, nenhuma linha é carregada — nem nome, nem chapa, nem nível. Para dar acesso a alguém, crie o usuário no painel do Supabase em Authentication.");
  p1.style.cssText="margin:7px 0 0;font-size:12.5px;color:var(--ink-2);max-width:70ch";who.appendChild(p1);
  var p2=el("p",null,"Toda alteração de nível e de atribuição grava uma linha na tabela de auditoria, com o e-mail de quem mudou e a data. Ninguém consegue apagar nem editar esse registro depois. Aparece no Histórico de avaliações dentro da tela Pessoa.");
  p2.style.cssText="margin:8px 0 0;font-size:12.5px;color:var(--ink-2);max-width:70ch";who.appendChild(p2);
  var p3=el("p",null,"Conectado como: "+(S.email||"—")+" · "+(canWrite()?"pode alterar":"somente leitura"));
  p3.style.cssText="margin:10px 0 0;font-size:12.5px;font-weight:600";who.appendChild(p3);
  box.appendChild(who);
}
function importCard(kind){
  var card=el("div","card pad");card.style.marginTop="14px";
  card.appendChild(el("span","eyebrow","Subir em massa"));
  var h=el("p","hint");
  if(kind==="pecas"){
    h.appendChild(document.createTextNode("Cole uma linha por peça, separando com ponto e vírgula ou tabulação (dá para colar direto do Excel): "));
    h.appendChild(el("code",null,"NOME;CATEGORIA;META;CRITICA;PROCESSO;CODIGOS;APLICACOES"));
    h.appendChild(document.createTextNode(" — meta de 1 a 5, crítica aceita SIM ou NAO, processo aceita TW, SAW ou AMBOS, códigos é um número. Só o nome é obrigatório."));
  }else{
    h.appendChild(document.createTextNode("Cole uma linha por pessoa, separando com ponto e vírgula ou tabulação: "));
    h.appendChild(el("code",null,"CHAPA;NOME;CARGO;TURNO"));
    h.appendChild(document.createTextNode(" — chapa e nome bastam."));
  }
  h.style.marginTop="8px";card.appendChild(h);
  var ta=el("textarea","paste");ta.style.marginTop="10px";ta.disabled=!canWrite();
  ta.placeholder=kind==="pecas"?"PINO;Componentes & Caldeiraria;3;NAO;AMBOS\nBUCHA;Componentes & Caldeiraria;3;NAO;TW":"13011;JOSE DA SILVA;SOLDADOR II;ADM3 · Diurno";
  card.appendChild(ta);
  var row=el("div","bar");row.style.marginTop="10px";
  var b1=el("button","btn","Adicionar à base");b1.type="button";b1.disabled=!canWrite();
  b1.onclick=function(){doImport(kind,ta.value)};
  row.appendChild(b1);card.appendChild(row);
  var warn=el("p","hint");warn.style.marginTop="9px";
  warn.textContent="Um registro com o mesmo nome (ou a mesma chapa) é atualizado, não duplicado. Os níveis já lançados são preservados.";
  card.appendChild(warn);
  return card;
}
function splitLine(l){return l.split(/[;\t]/).map(function(x){return x.trim()})}
function doImport(kind,text){
  if(!requireWrite())return;
  var lines=String(text).split(/\r?\n/).map(function(l){return l.trim()}).filter(Boolean);
  if(!lines.length){toast("Cole alguma coisa antes");return}
  var added=0,upd=0;
  if(kind==="pecas"){
    var byName={};S.pieces.forEach(function(p){byName[String(p.name).toUpperCase()]=p});
    lines.forEach(function(l){
      var f=splitLine(l);if(!f[0])return;
      var nm=f[0].toUpperCase();
      if(/^(NOME|PE[ÇC]A)$/.test(nm))return;
      var pc=byName[nm];
      if(pc){
        if(f[1])pc.cat=f[1];
        if(f[2])pc.goal=Math.min(5,Math.max(1,Number(f[2])||pc.goal));
        if(f[3])pc.crit=/^(S|SIM|1|TRUE|X)$/i.test(f[3]);
        if(f[4])pc.procs=/^(TW|SAW)$/i.test(f[4])?f[4].toUpperCase():"AMBOS";
        if(f[5])pc.codes=Number(String(f[5]).replace(/\D/g,""))||pc.codes||0;
        if(f[6])pc.apps=f[6];
        upd++;
      }else{
        pc={id:nextPieceId(),name:nm,cat:f[1]||"Sem linha definida",
            goal:f[2]?Math.min(5,Math.max(1,Number(f[2])||4)):4,
            crit:f[3]?/^(S|SIM|1|TRUE|X)$/i.test(f[3]):false,
            procs:f[4]?(/^(TW|SAW)$/i.test(f[4])?f[4].toUpperCase():"AMBOS"):"AMBOS",
            codes:f[5]?Number(String(f[5]).replace(/\D/g,""))||0:0,
            apps:f[6]||""};
        S.pieces.push(pc);byName[nm]=pc;added++;
      }
      savePiece(pc);
    });
  }else{
    var byCh={},byNm={};
    S.people.forEach(function(p){if(p.chapa)byCh[p.chapa]=p;byNm[String(p.name).toUpperCase()]=p});
    lines.forEach(function(l){
      var f=splitLine(l);if(!f[0]&&!f[1])return;
      if(/^CHAPA$/i.test(f[0]))return;
      var chapa=f[1]?f[0]:"",name=String(f[1]||f[0]).toUpperCase();
      var p=(chapa&&byCh[chapa])||byNm[name];
      if(p){
        p.chapa=chapa||p.chapa;p.name=name;
        if(f[2])p.role=f[2];
        if(f[3])p.turno=f[3];
        upd++;
      }else{
        p={id:newPid(),chapa:chapa,name:name,role:f[2]||"SOLDADOR I",turno:f[3]||"ADM3 · Diurno"};
        S.people.push(p);if(chapa)byCh[chapa]=p;byNm[name]=p;added++;
      }
      savePerson(p);
    });
    if(!byId(S.who))S.who=S.people[0]?S.people[0].id:null;
  }
  refreshFilters();renderBase();renderAll();
  toast(added+(added===1?" registro novo":" registros novos")+(upd?" · "+upd+" atualizados":""));
}

/* ------------- CSV ------------- */
function csv(){
  var ppl=people(),pcs=pieces();
  var rows=[["PROCESSO","CHAPA","NOME","CARGO","TURNO"].concat(pcs.map(function(p){return p.name}))
    .concat(["NA_META","TOTAL","DOMINIO_%","VENCIDAS"])];
  ppl.forEach(function(p){var s=pStat(p,pcs);
    rows.push([S.proc,p.chapa||"",p.name,p.role,p.turno]
      .concat(pcs.map(function(pc){return isAsg(p.id,pc.id)?String(getL(p.id,pc.id)):""}))
      .concat([String(s.hit),String(s.n),String(Math.round(s.avg)),String(s.old)]))});
  rows.push([]);
  rows.push(["META POR PECA"].concat(pcs.map(function(p){return p.name+"="+p.goal})));
  rows.push(["OBS","So o processo "+S.proc+". Celula vazia = a pessoa nao solda essa peca. Validade "+S.cfg.validade+" meses."]);
  return rows.map(function(r){return r.map(function(c){return /[;"\n]/.test(c)?'"'+String(c).replace(/"/g,'""')+'"':c}).join(";")}).join("\n");
}
function copyFallback(x){
  var ta=el("textarea");ta.value=x;ta.style.cssText="position:fixed;left:-9999px";
  document.body.appendChild(ta);ta.select();
  try{document.execCommand("copy");toast("CSV de "+S.proc+" copiado")}catch(e){toast("Não consegui copiar daqui")}
  document.body.removeChild(ta);
}

/* ------------- navegação ------------- */
var TITLES={
  geral:["Visão geral","Onde a célula está hoje e o que resolver primeiro."],
  matriz:["Matriz","Cada pizza é o nível de uma pessoa numa peça."],
  comp:["Comparativo","Gráficos sempre dentro do mesmo processo — TW com TW, SAW com SAW."],
  pessoa:["Pessoa","As peças que ele solda, o nível em cada uma e o histórico."],
  riscos:["Riscos","Peças que dependem de pouca gente neste processo."],
  base:["Base de dados","Cadastre quem solda, o que a célula solda e de quanto em quanto tempo revisar."]
};
function setAssign(on){
  S.assign=!!on&&canWrite();
  var cb=$("#fAssign");if(cb)cb.checked=S.assign;
  $("#pillAssign").classList.toggle("on",S.assign);
}
function setView(v){
  if(v!==S.view)setAssign(false);   // o modo nunca atravessa telas
  S.view=v;
  document.querySelectorAll("#nav button").forEach(function(b){b.setAttribute("aria-current",String(b.dataset.v===v))});
  document.querySelectorAll(".view").forEach(function(s){s.classList.remove("on")});
  if(S.ready)$("#v-"+v).classList.add("on");
  $("#pgTitle").textContent=TITLES[v][0];
  $("#pgSub").textContent=TITLES[v][1];
  $("#filters").hidden=(v==="pessoa"||v==="base");
  renderAll();
}
function renderAll(){
  if(!S.ready)return;
  renderGeral();
  if(S.view==="matriz")renderMatriz();
  if(S.view==="comp")renderComp();
  if(S.view==="pessoa")renderPessoa();
  if(S.view==="riscos")renderRiscos();
  if(S.view==="base")renderBase();
}
function refreshFilters(){
  var tu=[],ca=[],ct=[];
  S.people.forEach(function(p){if(p.turno&&tu.indexOf(p.turno)<0)tu.push(p.turno);if(p.role&&ca.indexOf(p.role)<0)ca.push(p.role)});
  S.pieces.forEach(function(p){if(p.cat&&ct.indexOf(p.cat)<0)ct.push(p.cat)});
  [["#fTurno",tu,"Todos os turnos"],["#fCargo",ca,"Todos os cargos"],["#fCat",ct,"Todas as categorias"]].forEach(function(o){
    var s=$(o[0]),cur=s.value;s.textContent="";
    var d=el("option",null,o[2]);d.value="";s.appendChild(d);
    o[1].sort().forEach(function(v){var x=el("option",null,v);x.value=v;s.appendChild(x)});
    s.value=o[1].indexOf(cur)>=0?cur:"";
  });
}
function setConn(){
  var el2=$("#conn"),tx=$("#connTx");
  el2.className="conn";
  if(S.mode==="off"){tx.textContent="sem conexão"}
  else if(canWrite()){el2.classList.add("live");tx.textContent=S.email||"conectado"}
  else {el2.classList.add("ro");tx.textContent="somente leitura"}
}
function markReady(){
  if(S.ready)return;
  S.ready=true;
  $("#boot").hidden=true;
  $("#v-"+S.view).classList.add("on");
  refreshFilters();renderAll();
}
function bindUI(){
  $("#nav").addEventListener("click",function(e){var b=e.target.closest("button[data-v]");if(b)setView(b.dataset.v)});
  $("#compTabs").addEventListener("click",function(e){var b=e.target.closest("button[data-c]");if(b){S.comp=b.dataset.c;renderComp()}});
  $("#baseTabs").addEventListener("click",function(e){var b=e.target.closest("button[data-b]");if(b){S.baseTab=b.dataset.b;renderBase()}});
  $("#pTW").addEventListener("click",function(){setAssign(false);S.proc="TW";$("#pTW").setAttribute("aria-pressed","true");$("#pSAW").setAttribute("aria-pressed","false");BULK.sel=null;renderAll()});
  $("#pSAW").addEventListener("click",function(){setAssign(false);S.proc="SAW";$("#pSAW").setAttribute("aria-pressed","true");$("#pTW").setAttribute("aria-pressed","false");BULK.sel=null;renderAll()});
  $("#aOff").addEventListener("click",function(){setAssign(false);renderAll();toast("Voltou a lançar nível")});
  $("#demoOff").addEventListener("click",function(){
    if(!requireWrite())return;
    S.cfg.demo=false;saveCfg();renderAll();toast("Aviso de dados de exemplo removido")});
  ["q","fTurno","fCargo","fCat","fCrit","fGap","fOld"].forEach(function(id){$("#"+id).addEventListener("input",renderAll)});
  $("#fAssign").addEventListener("change",function(){setAssign(this.checked);renderAll()});
  $("#fCrit").addEventListener("change",function(){$("#pillCrit").classList.toggle("on",this.checked)});
  $("#fGap").addEventListener("change",function(){$("#pillGap").classList.toggle("on",this.checked)});
  $("#fOld").addEventListener("change",function(){$("#pillOld").classList.toggle("on",this.checked)});
  $("#btnCsv").addEventListener("click",function(){
    var x=csv();
    try{navigator.clipboard.writeText(x).then(function(){toast("CSV de "+S.proc+" copiado")},function(){copyFallback(x)})}
    catch(e){copyFallback(x)}});
  $("#btnTheme").addEventListener("click",function(){
    var c2=document.documentElement.getAttribute("data-theme");
    var dark=c2?c2==="dark":matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.setAttribute("data-theme",dark?"light":"dark")});
  $("#btnConta").addEventListener("click",abrirConta);
}

/* ------------- carga ------------- */
function carregarNiveis(){
  return SB.from("levels").select("person_id,piece_id,proc,assigned,level,rated_at").then(function(r){
    if(r.error){toast("Não consegui ler os níveis: "+r.error.message);return}
    var m={};
    (r.data||[]).forEach(function(x){
      var k=x.person_id+"__"+x.proc;
      var d=m[k]||(m[k]={lv:{},asg:{},ts:{}});
      d.lv[x.piece_id]=x.level;
      if(x.assigned)d.asg[x.piece_id]=1;
      d.ts[x.piece_id]=x.rated_at?new Date(x.rated_at).getTime():0;
    });
    S.grid=m;
    if(S.ready)renderAll();
  });
}
function carregarTudo(){
  return Promise.all([
    SB.from("people").select("id,chapa,name,role,turno").order("name"),
    SB.from("pieces").select("id,name,cat,crit,goal,procs,codes,apps").order("id"),
    SB.from("config").select("validade,demo").eq("id",1).maybeSingle(),
    carregarNiveis()
  ]).then(function(res){
    var pe=res[0],pc=res[1],cf=res[2];
    if(pe.error||pc.error){
      S.mode="off";setConn();
      $("#boot").innerHTML="";
      $("#boot").appendChild(el("span","eyebrow","Erro"));
      $("#boot").appendChild(el("strong",null,"Não consegui ler o banco."));
      var p1=el("span","hint",(pe.error||pc.error).message+" — recarregue a página ou entre de novo.");
      $("#boot").appendChild(p1);
      return;
    }
    S.people=pe.data||[];
    S.pieces=(pc.data||[]).map(function(x){x.id=Number(x.id);x.goal=Number(x.goal);x.codes=Number(x.codes)||0;return x});
    if(cf&&cf.data){S.cfg.validade=Number(cf.data.validade)||6;S.cfg.demo=!!cf.data.demo}
    if(!byId(S.who))S.who=S.people[0]?S.people[0].id:null;
    if(!byId(S.duelA))S.duelA=S.people[0]?S.people[0].id:null;
    if(!byId(S.duelB))S.duelB=S.people[1]?S.people[1].id:S.duelA;
    markReady();
  });
}

/* ------------- login ------------- */
function abrirLogin(msg){
  var bx=$("#login");bx.hidden=false;
  $("#loginMsg").textContent=msg||"";
  setTimeout(function(){$("#loginEmail").focus()},80);
}
function fecharLogin(){$("#login").hidden=true}
function entrar(){
  var em=$("#loginEmail").value.trim(),pw=$("#loginPass").value;
  if(!em||!pw){$("#loginMsg").textContent="Preencha e-mail e senha.";return}
  $("#loginBtn").disabled=true;$("#loginMsg").textContent="Entrando…";
  SB.auth.signInWithPassword({email:em,password:pw}).then(function(r){
    $("#loginBtn").disabled=false;
    if(r.error){$("#loginMsg").textContent=r.error.message==="Invalid login credentials"?"E-mail ou senha incorretos.":r.error.message;return}
    fecharLogin();aposLogin(r.data.session);
  });
}
function aposLogin(sess){
  S.uid=sess.user.id;S.email=sess.user.email||"";S.canWrite=true;S.mode="on";
  setConn();
  if(S.ready){renderAll()}else{carregarTudo()}
}
function abrirConta(){
  var bx=$("#conta");bx.hidden=false;
  $("#contaQuem").textContent=S.email||"não identificado";
  $("#contaMsg").textContent="";
}
function trocarSenha(){
  var p1=$("#novaSenha").value,p2=$("#novaSenha2").value;
  if(p1.length<8){$("#contaMsg").textContent="A senha precisa ter pelo menos 8 caracteres.";return}
  if(p1!==p2){$("#contaMsg").textContent="As duas senhas não são iguais.";return}
  $("#contaMsg").textContent="Trocando…";
  SB.auth.updateUser({password:p1}).then(function(r){
    if(r.error){$("#contaMsg").textContent=r.error.message;return}
    $("#contaMsg").textContent="Senha trocada.";
    $("#novaSenha").value="";$("#novaSenha2").value="";
    setTimeout(function(){$("#conta").hidden=true;toast("Senha trocada com sucesso")},700);
  });
}
function sair(){
  SB.auth.signOut().then(function(){location.reload()});
}

function boot(){
  bindUI();
  if(!window.supabase||!window.SB_URL){
    $("#boot").textContent="Falha ao carregar a biblioteca do banco. Recarregue a página.";
    return;
  }
  SB=window.supabase.createClient(window.SB_URL,window.SB_KEY,{auth:{persistSession:true,autoRefreshToken:true}});
  $("#loginBtn").addEventListener("click",entrar);
  $("#loginPass").addEventListener("keydown",function(e){if(e.key==="Enter")entrar()});
  $("#loginEmail").addEventListener("keydown",function(e){if(e.key==="Enter")$("#loginPass").focus()});
  $("#contaSalvar").addEventListener("click",trocarSenha);
  $("#contaFechar").addEventListener("click",function(){$("#conta").hidden=true});
  $("#contaSair").addEventListener("click",sair);
  setConn();
  SB.auth.getSession().then(function(r){
    var s=r.data&&r.data.session;
    if(s){aposLogin(s)}
    else{$("#boot").hidden=true;abrirLogin("")}
  });
  SB.auth.onAuthStateChange(function(ev,s){
    if(ev==="SIGNED_OUT"){S.canWrite=false;setConn()}
    if(ev==="TOKEN_REFRESHED"&&s){S.uid=s.user.id}
  });
}
boot();
})();
