/**
 * DOCUMENTATION HUB - GOOGLE GEMINI BACKEND
 * Para Vercel - Serverless Function
 * 
 * Coloca en: /api/gemini.js
 */

export default async function handler(req, res) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({
            error: 'Método no permitido',
            code: 'METHOD_NOT_ALLOWED'
        });
    }

    try {
        const { apiKey, question, documents } = req.body;

        // Validar inputs
        if (!apiKey || !question || !Array.isArray(documents)) {
            return res.status(400).json({
                error: 'Parámetros inválidos',
                code: 'INVALID_INPUT'
            });
        }

        // Validar API key de Google
        if (typeof apiKey !== 'string' || !apiKey.startsWith('AIza') || apiKey.length < 30) {
            return res.status(401).json({
                error: 'API key inválida. Debe empezar con AIza',
                code: 'INVALID_API_KEY'
            });
        }

        // Sanitizar pregunta
        const sanitizedQuestion = String(question).trim();
        if (sanitizedQuestion.length < 3) {
            return res.status(400).json({
                error: 'Pregunta muy corta',
                code: 'QUESTION_TOO_SHORT'
            });
        }

        // Construir contexto
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

        // Construir prompt para Gemini
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

        // Llamar a Google Gemini API
        console.log('📡 Enviando request a Gemini API...');

        const geminiResponse = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`,
            {
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
                    safetySettings: [
                        {
                            category: 'HARM_CATEGORY_UNSPECIFIED',
                            threshold: 'BLOCK_NONE'
                        }
                    ],
                    generationConfig: {
                        temperature: 0.7,
                        topK: 40,
                        topP: 0.95,
                        maxOutputTokens: 1024,
                    }
                })
            }
        );

        console.log('📬 Status Gemini:', geminiResponse.status);

        if (!geminiResponse.ok) {
            const errorData = await geminiResponse.json();
            console.error('Gemini error:', errorData);

            if (geminiResponse.status === 400) {
                // Bad request - probablemente API key inválida o formato incorrecto
                if (errorData.error?.message?.includes('API key')) {
                    return res.status(401).json({
                        error: 'API key inválida o expirada',
                        code: 'INVALID_API_KEY'
                    });
                }
                return res.status(400).json({
                    error: 'Solicitud inválida: ' + (errorData.error?.message || 'error desconocido'),
                    code: 'BAD_REQUEST'
                });
            }

            if (geminiResponse.status === 403) {
                return res.status(403).json({
                    error: 'Acceso denegado. Verifica tu API key de Google Gemini.',
                    code: 'FORBIDDEN'
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
                    error: 'Servidores de Google no disponibles. Intenta más tarde.',
                    code: 'SERVER_ERROR'
                });
            }

            return res.status(geminiResponse.status).json({
                error: errorData.error?.message || 'Error en Gemini API',
                code: 'GEMINI_ERROR'
            });
        }

        const data = await geminiResponse.json();
        console.log('✅ Respuesta de Gemini recibida');

        // Extraer texto de la respuesta
        if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
            return res.status(500).json({
                error: 'Respuesta inválida de Gemini',
                code: 'INVALID_RESPONSE'
            });
        }

        const responseText = data.candidates[0].content.parts[0].text;

        return res.status(200).json({
            success: true,
            response: responseText,
            model: 'gemini-pro',
            usage: {
                promptTokens: data.usageMetadata?.promptTokenCount || 0,
                outputTokens: data.usageMetadata?.candidatesTokenCount || 0
            }
        });

    } catch (error) {
        console.error('Unhandled error:', error);

        let errorCode = 'INTERNAL_ERROR';
        let errorMsg = 'Error interno del servidor';

        if (error.message.includes('fetch')) {
            errorCode = 'NETWORK_ERROR';
            errorMsg = 'Error de conectividad con Gemini API';
        } else if (error.message.includes('JSON')) {
            errorCode = 'JSON_ERROR';
            errorMsg = 'Error al procesar JSON';
        }

        return res.status(500).json({
            error: errorMsg,
            code: errorCode,
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}
