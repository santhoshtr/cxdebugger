async function request(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${(await response.text()).slice(0, 300)}`);
  }
  return response;
}

function postOptions(body) {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}

export async function getJSON(url) {
  return (await request(url)).json();
}

export async function postForJSON(url, body) {
  return (await request(url, postOptions(body))).json();
}

export async function postForText(url, body) {
  return (await request(url, postOptions(body))).text();
}
