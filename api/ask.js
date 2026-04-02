export default async function handler(req, res) {
    // 🔥 CORS HEADERS (SIEMPRE LO PRIMERO)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // ✅ PRELIGHT (ESTO SOLUCIONA TU ERROR)
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // ❌ SOLO PERMITIMOS POST
    if (req.method !== 'POST') {
        return res.status(405).json({
            error: 'Método no permitido'
        });
    }

    try {
        const { apiKey, question, documents } = req.body;

        if (!apiKey || !question || !Array.isArray(documents)) {
            return res.status(400).json({
                error: 'Parámetros inválidos'
            });
        }

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-opus-4-1-20250805',
                max_tokens: 500,
                messages: [
                    {
                        role: 'user',
                        content: question
                    }
                ]
            })
        });

        const data = await response.json();

        return res.status(200).json({
            success: true,
            response: data?.content?.[0]?.text || 'Sin respuesta'
        });

    } catch (error) {
        console.error(error);

        return res.status(500).json({
            error: 'Error interno'
        });
    }
}
