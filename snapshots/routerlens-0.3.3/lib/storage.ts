export type DB = { prepare(sql:string):any; batch(statements:any[]):Promise<any> };
export class Store {
  constructor(private db?:DB){}
  private database(){if(!this.db)throw new Error('STORAGE_UNAVAILABLE');return this.db;}
  async report(id:string){const row=await this.database().prepare('SELECT * FROM reports WHERE id=?').bind(id).first();return row?{...row,payload:JSON.parse(row.payload)}:null;}
  async saveReport(id:string,kind:string,payload:unknown){
    await this.database().prepare('INSERT INTO reports(id,kind,created_at,payload) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(id,kind,new Date().toISOString(),JSON.stringify(payload)).run();
    return this.report(id);
  }
  async reports(limit:number){const x=await this.database().prepare('SELECT id,kind,created_at,delivery_state,message_id FROM reports ORDER BY created_at DESC LIMIT ?').bind(limit).all();return x.results;}
  async claim(id:string){const result=await this.database().prepare("UPDATE reports SET delivery_state='sending' WHERE id=? AND delivery_state='pending'").bind(id).run();return {claimed:result.meta.changes===1,report:await this.report(id)};}
  async delivered(id:string,state:string,messageId:string|null){const result=await this.database().prepare("UPDATE reports SET delivery_state=?,message_id=? WHERE id=? AND delivery_state='sending'").bind(state,messageId,id).run();return {updated:result.meta.changes===1,report:await this.report(id)};}
  async experiment(id:string){const row=await this.database().prepare('SELECT * FROM experiments WHERE id=?').bind(id).first();if(!row)return null;const rows=await this.database().prepare('SELECT * FROM observations WHERE experiment_id=? ORDER BY case_id,variant').bind(id).all();return {...row,plan:JSON.parse(row.plan),observations:rows.results};}
  async experiments(){const x=await this.database().prepare('SELECT id,created_at FROM experiments ORDER BY created_at DESC LIMIT 50').all();return x.results;}
  async saveExperiment(id:string,plan:unknown){await this.database().prepare('INSERT INTO experiments(id,created_at,plan) VALUES(?,?,?) ON CONFLICT(id) DO NOTHING').bind(id,new Date().toISOString(),JSON.stringify(plan)).run();return this.experiment(id);}
  async observation(id:string,row:any){await this.database().prepare('INSERT INTO observations(experiment_id,case_id,variant,generation_id,cost_usd,latency_ms,quality_pass,success,source) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(experiment_id,case_id,variant) DO UPDATE SET generation_id=excluded.generation_id,cost_usd=excluded.cost_usd,latency_ms=excluded.latency_ms,quality_pass=excluded.quality_pass,success=excluded.success,source=excluded.source').bind(id,row.case_id,row.variant,row.generation_id??null,row.cost_usd,row.latency_ms??null,+row.quality_pass,+row.success,row.source).run();}
}
