import { ownerConfigured } from '../../../../../../packages/host/src/auth';
import { failure,json } from '../../../../../../packages/host/src/http';
export async function GET(){try{return json({configured:await ownerConfigured()});}catch(e){return failure(e);}}
