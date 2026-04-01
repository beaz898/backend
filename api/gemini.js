/**
 * DOCUMENTATION HUB - GOOGLE GEMINI BACKEND CORREGIDO
 * Para Vercel
 * 
 * Coloca en: /api/gemini.js
 */

export default async function handler(req, res) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method === 'GET') {
        return res.status(200).json({ status: 'ok' });
    }

    if (req.method !== 'POST') {
        return res.status(405).json({
            error: 'Método no permitido',
            code: 'METHOD_NOT_ALLOWED'
        });
    }

    try {
        console.log('=== Gemini Backend Request ===');
        
        const { apiKey, question, documents } = req.body;

        // Validar inputs
        if (!apiKey || !question || !Array.isArray(documents)) {
            console.error('Invalid input parameters');
            return res.status(400).json({
                error: 'Parámetros inválidos',
                code: 'INVALID_INPUT'
            });
        }

        // Validar API key
        if (typeof apiKey !== 'string' || !apiKey.startsWith('AIza') || apiKey.length < 30) {
            console.error('Invalid API key format');
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
            console.error('Error processing documents:', e);
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

        // Construir prompt
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

        console.log('Calling Gemini API...');
        
        // URL correcta para Gemini
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

        console.log('Gemini response status:', geminiResponse.status);

        if (!geminiResponse.ok) {
            const errorData = await geminiResponse.json().catch(() => ({}));
            console.error('Gemini error response:', errorData);

            if (geminiResponse.status === 400) {
                console.error('Bad request to Gemini');
                if (errorData.error?.message?.includes('API key')) {
                    return res.status(401).json({
                        error: 'API key inválida. Verifica que empiece con AIza',
                        code: 'INVALID_API_KEY'
                    });
                }
                return res.status(400).json({
                    error: 'Solicitud inválida a Gemini',
                    code: 'BAD_REQUEST'
                });
            }

            if (geminiResponse.status === 403) {
                console.error('Forbidden - API key issue');
                return res.status(403).json({
                    error: 'Acceso denegado. Verifica tu API key de Google.',
                    code: 'FORBIDDEN'
                });
            }

            if (geminiResponse.status === 401) {
                console.error('Unauthorized');
                return res.status(401).json({
                    error: 'API key no autorizada. Crea una nueva en aistudio.google.com',
                    code: 'UNAUTHORIZED'
                });
            }

            if (geminiResponse.status === 429) {
                console.error('Rate limit');
                return res.status(429).json({
                    error: 'Límite de Gemini excedido. Intenta en unos segundos.',
                    code: 'RATE_LIMIT'
                });
            }

            if (geminiResponse.status >= 500) {
                console.error('Server error');
                return res.status(503).json({
                    error: 'Servidores de Google no disponibles.',
                    code: 'SERVER_ERROR'
                });
            }

            console.error('Other Gemini error:', geminiResponse.status);
            return res.status(geminiResponse.status).json({
                error: 'Error en Gemini API: ' + (errorData.error?.message || 'desconocido'),
                code: 'GEMINI_ERROR'
            });
        }

        const data = await geminiResponse.json();
        console.log('Gemini response successful');

        // Extraer texto
        if (!data.candidates || !data.candidates[0]?.content?.parts) {
            console.error('Invalid Gemini response structure');
            return res.status(500).json({
                error: 'Respuesta inválida de Gemini',
                code: 'INVALID_RESPONSE'
            });
        }

        const responseText = data.candidates[0].content.parts[0].text;

        console.log('Success - returning response');
        return res.status(200).json({
            success: true,
            response: responseText,
            model: 'gemini-1.5-flash'
        });

    } catch (error) {
        console.error('Unhandled error:', error);
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);

        return res.status(500).json({
            error: 'Error interno: ' + error.message,
            code: 'INTERNAL_ERROR',
            details: error.message
        });
    }
}
