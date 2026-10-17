// Pre-paint attributes and theme-color from saved settings.
{
let d=document.documentElement.dataset,s={},m=q=>matchMedia(q).matches;
try{s=JSON.parse(localStorage.getItem('braintune:settings:v1'))||{}}catch(e){}
let B={sleep:'delta',rest:'delta',meditate:'theta',catnap:'theta',calm:'alpha',focus:'beta',energise:'beta',clarity:'gamma'},
S={dark:{delta:'#070A1F',theta:'#0E0820',alpha:'#05161C',beta:'#061222',gamma:'#12091F'},light:{delta:'#E9ECFF',theta:'#F3EBFF',alpha:'#E4F8F5',beta:'#E6F3FF',gamma:'#FFF3E6'}},
b=s.custom&&s.custom.beatHz,band=b?b<4?'delta':b<8?'theta':b<13?'alpha':b<30?'beta':'gamma':B[s.presetId]||'alpha',
t=s.theme==='light'||s.theme==='auto'&&m('(prefers-color-scheme: light)')?'light':'dark';
d.theme=t;d.band=band;
d.motion=s.motion==='still'||s.motion!=='full'&&m('(prefers-reduced-motion: reduce)')?'still':'full';
d.scene=s.scene==='off'?'off':'full';
d.cats=s.cats&&s.cats.enabled===false?'off':'on';
(document.querySelector('meta[name=theme-color]')||{}).content=S[t][band];
}
