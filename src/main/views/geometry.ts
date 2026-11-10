import type { RectDip, RoomGeometry } from '../../shared/contracts.ts';

function roundedRect(rect:RectDip):RectDip {
  const x=Math.round(rect.x),y=Math.round(rect.y);
  return {x,y,width:Math.max(0,Math.round(rect.x+rect.width)-x),height:Math.max(0,Math.round(rect.y+rect.height)-y)};
}
export function nativeGeometry(geometry:RoomGeometry,offset:{x:number;y:number}):{group:RectDip;chrome:RectDip;page:RectDip}|undefined {
  const {outer,content}=geometry;
  if(![...Object.values(outer),...Object.values(content),offset.x,offset.y].every(Number.isFinite)||!Number.isSafeInteger(geometry.z)||geometry.z<0||outer.width<0||outer.height<0||content.width<0||content.height<0)return;
  const group=roundedRect({...outer,x:outer.x+offset.x,y:outer.y+offset.y});
  // Round canvas boundaries once, then derive all group-local coordinates.
  const absoluteContent=roundedRect({...content,x:content.x+offset.x,y:content.y+offset.y});
  const page={...absoluteContent,x:absoluteContent.x-group.x,y:absoluteContent.y-group.y};
  const all=[...Object.values(group),...Object.values(page)];
  if(!all.every(value=>Number.isSafeInteger(value)&&value>=-2_147_483_648&&value<=2_147_483_647))return;
  return {group,chrome:{x:0,y:0,width:group.width,height:group.height},page};
}
