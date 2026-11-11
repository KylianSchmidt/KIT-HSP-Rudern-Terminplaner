// All network code. Every function resolves with the parsed response or throws ApiError.
// ApiError.code is the backend `error` string, or 'network' / 'bad_response' for client-side failures.
import {API_URL} from './config.js';
import * as mock from './mock.js';

const useMock = () => /(^|[#&])mock(=|&|$)/.test(location.hash);

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
  if (useMock()) return mock.getState();
  return request(`${API_URL}?action=state&t=${encodeURIComponent(token)}`);
}

// A string body and no headers keep this a "simple" request (text/plain), so no CORS preflight.
function write(payload) {
  return request(API_URL, {method: 'POST', body: JSON.stringify(payload)});
}

// A choice is a seat in a boat, or (seat = null) a whole boat category 'cat:<key>'.
export function pick(token, session_id, member_id, boat_id, seat) {
  if (useMock()) return mock.write({type: 'pick', sid: session_id, member: member_id, boat: boat_id, seat});
  return write({action: 'set', t: token, session_id, member_id, boat_id, seat: seat === null ? null : String(seat)});
}

export function remove(token, session_id, member_id, boat_id, seat) {
  if (useMock()) return mock.write({type: 'remove', sid: session_id, member: member_id, boat: boat_id, seat});
  return write({action: 'remove', t: token, session_id, member_id, boat_id, seat: seat === null ? null : String(seat)});
}
