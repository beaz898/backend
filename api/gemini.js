export default async function handler(req, res) {
    // CORS - Permitir desde cualquier origen (necesario para desarrollo local)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST,PUT,DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Requested-With,Accept');
    res.setHeader('Access-Control-Max-Age', '3600');
    res.setHeader('Content-Type', 'application/json');

    // Manejar preflight requests (OPTIONS)
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({
            error: 'Método no permitido',
            code: 'METHOD_NOT_ALLOWED'
        });
    }

    try {
        const { apiKey, question, documents } = req.body;

        if (!apiKey || !question || !Array.isArray(documents)) {
            return res.status(400).json({
                error: 'Parámetros inválidos',
                code: 'INVALID_INPUT'
            });
        }

        if (typeof apiKey !== 'string' || !apiKey.startsWith('AIza') || apiKey.length < 30) {
            return res.status(401).json({
                error: 'API key inválida. Debe empezar con AIza',
                code: 'INVALID_API_KEY'
            });
        }

        const sanitizedQuestion = String(question).trim();
        if (sanitizedQuestion.length < 3) {
            return res.status(400).json({
                error: 'Pregunta muy corta',
                code: 'QUESTION_TOO_SHORT'
            });
        }

        let documentContext = '';
        try {
            documentContext = documents
                .map(doc => {
                    const docName = String(doc.name || 'documento').substring(0, 200);
                    const docContent = String(doc.content || '').substring(0, 3000);
                    return `[${docName}]\n${docContent}`;
                })
                .join('\n\n---\n\n');
        } catch (e) {
            return res.status(400).json({
                error: 'Error al procesar documentos',
                code: 'INVALID_DOCUMENTS'
            });
        }

        if (!documentContext.trim()) {
            return res.status(400).json({
                error: 'No hay documentos válidos',
                code: 'NO_VALID_DOCUMENTS'
            });
        }

        const systemPrompt = `Eres un asistente inteligente para documentación empresarial.
Responde ÚNICAMENTE basándote en los documentos proporcionados.

INSTRUCCIONES:
1. Si encuentras la respuesta, cítala claramente
2. Si no hay información, di "No encontré información sobre esto en los documentos"
3. Sé conciso pero completo
4. Usa listas y párrafos para claridad
5. Mantén el mismo idioma de la pregunta
6. NUNCA inventes información`;

        const fullPrompt = `${systemPrompt}

DOCUMENTOS:
${documentContext}

PREGUNTA DEL USUARIO:
${sanitizedQuestion}

RESPUESTA:`;

        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

        const geminiResponse = await fetch(geminiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                contents: [
                    {
                        parts: [
                            {
                                text: fullPrompt
                            }
                        ]
                    }
                ],
                generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: 1024,
                }
            })
        });

        if (!geminiResponse.ok) {
            const errorData = await geminiResponse.json().catch(() => ({}));

            if (geminiResponse.status === 400) {
                return res.status(401).json({
                    error: 'API key inválida',
                    code: 'INVALID_API_KEY'
                });
            }

            if (geminiResponse.status === 403) {
                return res.status(403).json({
                    error: 'Acceso denegado. Verifica tu API key.',
                    code: 'FORBIDDEN'
                });
            }

            if (geminiResponse.status === 401) {
                return res.status(401).json({
                    error: 'API key no autorizada.',
                    code: 'UNAUTHORIZED'
                });
            }

            if (geminiResponse.status === 429) {
                return res.status(429).json({
                    error: 'Límite de Gemini excedido. Intenta en unos segundos.',
                    code: 'RATE_LIMIT'
                });
            }

            if (geminiResponse.status >= 500) {
                return res.status(503).json({
                    error: 'Servidores de Google no disponibles.',
                    code: 'SERVER_ERROR'
                });
            }

            return res.status(geminiResponse.status).json({
                error: 'Error en Gemini API',
                code: 'GEMINI_ERROR'
            });
        }

        const data = await geminiResponse.json();

        if (!data.candidates || !data.candidates[0]?.content?.parts) {
            return res.status(500).json({
                error: 'Respuesta inválida de Gemini',
                code: 'INVALID_RESPONSE'
            });
        }

        const responseText = data.candidates[0].content.parts[0].text;

        return res.status(200).json({
            success: true,
            response: responseText,
            model: 'gemini-1.5-flash'
        });

    } catch (error) {
        return res.status(500).json({
            error: 'Error interno: ' + error.message,
            code: 'INTERNAL_ERROR'
        });
    }
}
