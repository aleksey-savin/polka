/**
 * Единый User-Agent для внешних запросов.
 * СТРОГО ASCII: не-ASCII символ в HTTP-заголовке роняет fetch целиком
 * (реальный инцидент: кириллица в UA — и все запросы к OpenLibrary падали).
 */
export const POLKA_USER_AGENT = 'Polka/0.1 (home library; apslam88@gmail.com)'
