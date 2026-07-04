export function getPlayerCountOrNull (resp) {
  if (resp) {
    return resp.players.online
  }

  return null
}
