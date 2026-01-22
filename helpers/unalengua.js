export async function fetchIPA(
  input,
  lang,
) {
  const response = await fetch("https://api2.unalengua.com/ipav3", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: input,
      lang,
      mode: true,
    }),
  });

  const body = await response.json();

  if (body.ipa) {
    return body.ipa;
  } else {
    throw Error("Could not fetch IPA");
  }
}
