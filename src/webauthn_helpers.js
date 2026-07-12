(function() {
    "use strict";

    // Thin wrapper around browser-native WebAuthn. No encode/decode library
    // needed: the server (webauthn Ruby gem) emits options in the same
    // base64url JSON shape the WebAuthn Level 3 spec's
    // PublicKeyCredential.parseCreationOptionsFromJSON/toJSON() methods
    // already speak natively.

    function isWebAuthnSupported() {
        return typeof window.PublicKeyCredential !== "undefined" &&
            typeof window.PublicKeyCredential.parseCreationOptionsFromJSON === "function" &&
            typeof window.PublicKeyCredential.parseRequestOptionsFromJSON === "function";
    }

    async function createCredential(creationOptionsJson) {
        var publicKey = window.PublicKeyCredential.parseCreationOptionsFromJSON(creationOptionsJson);
        var credential = await navigator.credentials.create({ publicKey: publicKey });
        return credential.toJSON();
    }

    async function getCredential(requestOptionsJson) {
        var publicKey = window.PublicKeyCredential.parseRequestOptionsFromJSON(requestOptionsJson);
        var credential = await navigator.credentials.get({ publicKey: publicKey });
        return credential.toJSON();
    }

    window.LeftWordleWebauthn = {
        isSupported: isWebAuthnSupported,
        createCredential: createCredential,
        getCredential: getCredential
    };
})();
