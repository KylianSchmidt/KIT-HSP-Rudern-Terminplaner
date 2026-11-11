// All network code. Every function resolves with the parsed response or throws ApiError.
// ApiError.code is the backend `error` string, or 'network' / 'bad_response' for client-side failures.
import {API_URL} from './config.js';

export class ApiError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

async function parse(res) {
  let data;
  try {
    data = await res.json();
  } catch (err) {
    throw new ApiError('bad_response');
  }
  // HTTP status is always 200, so only `ok` counts.
  if (!data || data.ok !== true) throw new ApiError((data && data.error) || 'bad_response');
  return data;
}

async function request(url, init) {
  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw new ApiError('network');
  }
  return parse(res);
}

export function getState(token) {
  return request(`${API_URL}?action=state&t=${encodeURIComponent(token)}`);
}

// A string body and no headers keep this a "simple" request (text/plain), so no CORS preflight.
function write(payload) {
  return request(API_URL, {method: 'POST', body: JSON.stringify(payload)});
}

export function setSeat(token, session_id, member_id, boat_id, seat) {
  return write({action: 'set', t: token, session_id, member_id, boat_id, seat: String(seat)});
}

export function setRank(token, session_id, member_id, boat_id, rank) {
  return write({action: 'set', t: token, session_id, member_id, boat_id, rank});
}

export function remove(token, session_id, member_id, boat_id) {
  return write({action: 'remove', t: token, session_id, member_id, boat_id});
}
