export function getExpiryDate(seconds) {
    if (!seconds) return null;
    const date = new Date(Date.now() + seconds * 1000);
    return date.toISOString();
}