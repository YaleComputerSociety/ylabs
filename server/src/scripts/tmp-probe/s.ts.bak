import dotenv from 'dotenv'; import fs from 'fs'; import { MongoClient } from 'mongodb';
dotenv.config();
async function main(){
  const wide=JSON.parse(fs.readFileSync('/tmp/ylabs-3097/card-dry.json','utf8')).result.samples;
  const c=new MongoClient(String(process.env.MONGODBURL)); await c.connect();
  const slugs=wide.map((s:any)=>s.slug);
  const rows=await c.db().collection('research_entities')
    .find({slug:{$in:slugs}},{projection:{slug:1,shortDescription:1,studentVisibilityTier:1,studentVisibilityReasons:1}}).toArray();
  const by=new Map(rows.map((r:any)=>[r.slug,r]));
  let shown=0;
  for(const s of wide){
    const r:any=by.get(s.slug);
    if(!r) continue;
    const blocked=(r.studentVisibilityReasons||[]).includes('missing_card_description');
    if(blocked) continue;
    if(shown++>=8) break;
    console.log('---', s.action, '| tier', r.studentVisibilityTier);
    console.log('  WAS:', JSON.stringify(String(r.shortDescription||'')));
    console.log('  NOW:', JSON.stringify(String(s.shortDescription||'')));
  }
  console.log('\nnon-blocked samples shown:', shown);
  await c.close();
}
void main();
