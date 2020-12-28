import fetch from 'isomorphic-fetch';

export async function getJSON(url: string) {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  });
  return response.json();
}

export async function postJSON(url: string, data?: any) {
  let body = typeof data === 'string' ? data : JSON.stringify(data);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body
  });
  return response.json();
}