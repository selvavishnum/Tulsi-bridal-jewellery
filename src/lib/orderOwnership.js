/* Who owns an order. An order placed while signed in carries the user's
   id. A guest order only carries the email typed at checkout — so it
   belongs to a signed-in user only if they have PROVED that email (email
   code or Google sign-in), never on the strength of an unverified
   password registration, which anyone can make for someone else's
   address. Pure module. */
export function canMatchGuestOrders(user) {
  return !!user?.email && user.emailVerified === true;
}

export function ownsOrder(order, user) {
  if (!order || !user) return false;
  if (order.userId && user.id && order.userId === user.id) return true;
  return canMatchGuestOrders(user)
    && !!order.guestEmail
    && String(order.guestEmail).toLowerCase() === String(user.email).toLowerCase();
}
