import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token') ?? '';
  const collect = `${url.origin}/api/ads/collect`;
  const script = `(function(){var t=${JSON.stringify(token)};var u=${JSON.stringify(collect)};function send(n,d){try{var body=JSON.stringify(Object.assign({token:t,name:n,url:location.href,referrer:document.referrer,utmSource:(new URLSearchParams(location.search)).get("utm_source"),utmCampaign:(new URLSearchParams(location.search)).get("utm_campaign"),gclid:(new URLSearchParams(location.search)).get("gclid"),fbclid:(new URLSearchParams(location.search)).get("fbclid")},d||{}));if(navigator.sendBeacon){navigator.sendBeacon(u,new Blob([body],{type:"application/json"}));}else{fetch(u,{method:"POST",headers:{"content-type":"application/json"},body:body,keepalive:true});}}catch(e){}}send("page_view");window.cerevex=window.cerevex||{track:send};})();`;
  return new NextResponse(script, {
    status: token.length >= 8 ? 200 : 400,
    headers: {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
