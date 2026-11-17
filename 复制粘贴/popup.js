document.addEventListener('DOMContentLoaded',async()=>{
const d=document.getElementById('d'),b=document.getElementById('b');
let{enabled:e}=await chrome.storage.local.get(['enabled']);
e=e!==false;
const u=()=>{d.classList.toggle('on',e);b.textContent=e?'禁用':'启用'};
u();
b.onclick=async()=>{
e=!e;
await chrome.storage.local.set({enabled:e});
const[t]=await chrome.tabs.query({active:true,currentWindow:true});
t?.id&&chrome.tabs.sendMessage(t.id,{action:'toggle',enabled:e}).catch(()=>{});
u();
}});
