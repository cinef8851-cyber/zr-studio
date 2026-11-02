import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDatabaseSpec, provisionProjectSchema } from '../database.mjs';

test('aceita schema de negócio limitado a tipos e identificadores permitidos', () => {
  assert.deepEqual(validateDatabaseSpec({tables:[{name:'contacts',columns:[{name:'email',type:'text',required:true},{name:'age',type:'integer'}]}]}), {tables:[{name:'contacts',columns:[{name:'email',type:'text',required:true},{name:'age',type:'integer',required:false}]}]});
});

test('rejeita SQL, tipos e identificadores fornecidos sem allow-list', () => {
  assert.equal(validateDatabaseSpec({tables:[{name:'contacts; DROP TABLE users',columns:[{name:'email',type:'text'}]}]}), null);
  assert.equal(validateDatabaseSpec({tables:[{name:'contacts',columns:[{name:'email',type:'text; DROP TABLE users'}]}]}), null);
  assert.equal(validateDatabaseSpec({tables:[{name:'contacts',columns:[{name:'owner_id',type:'uuid'}]}]}), null);
});

test('provisiona schema e políticas de linha com RLS fail-closed', async () => {
  const queries=[];const sql={query:async(text,params)=>{queries.push({text,params});return []}};
  const result=await provisionProjectSchema(sql,{projectId:'project-12345678',projectName:'Demo',spec:{tables:[{name:'contacts',columns:[{name:'email',type:'text'}]}]}});
  assert.equal(result.tables[0],'contacts');
  assert(queries.some(q=>q.text.includes('ENABLE ROW LEVEL SECURITY')));
  assert(queries.some(q=>q.text.includes('FORCE ROW LEVEL SECURITY')));
  assert(queries.some(q=>q.text.includes("current_setting('zr.user_id', true)")));
  assert.equal(queries.at(-1).params[0],'project-12345678');
  assert(!queries.some(q=>q.text.includes('project-12345678')));
});
