export function messageOf (name, data) {
  return JSON.stringify({
    message: name,
    ...data
  })
}
