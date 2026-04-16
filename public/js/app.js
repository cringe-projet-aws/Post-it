// variables globales pour le drag and drop
var postitEnCours = null;
var offsetX = 0;
var offsetY = 0;

// pour la détection du double-tap sur mobile
var lastTap = 0;
var lastTapX = 0;
var lastTapY = 0;

// pour la création d'un postit
var coordX = 0;
var coordY = 0;

// action en cours dans le modal: 'creer' ou 'modifier'
var actionModal = '';
var idPostitModal = null;

var tableau = document.getElementById('tableau');
var modal = document.getElementById('modal');

// ouvrir le modal
function ouvrirModal(action, id, texteActuel) {
    actionModal = action;
    idPostitModal = id || null;

    if (action == 'creer') {
        document.getElementById('modal-titre').textContent = 'Nouveau post-it';
        document.getElementById('modal-texte').value = '';
    } else {
        document.getElementById('modal-titre').textContent = 'Modifier le post-it';
        document.getElementById('modal-texte').value = texteActuel || '';
    }
    document.getElementById('compteur-chars').textContent = document.getElementById('modal-texte').value.length + ' / 500';
    modal.style.display = 'flex';
    document.getElementById('modal-texte').focus();
}

// fermer le modal
function fermerModal() {
    modal.style.display = 'none';
    actionModal = '';
    idPostitModal = null;
}

// compter les caractères dans le textarea
document.getElementById('modal-texte').addEventListener('input', function() {
    document.getElementById('compteur-chars').textContent = this.value.length + ' / 500';
});

// bouton annuler
document.getElementById('modal-annuler').addEventListener('click', function() {
    fermerModal();
});

// fermer si on clique en dehors du modal
modal.addEventListener('click', function(e) {
    if (e.target === modal) {
        fermerModal();
    }
});

// touche Échap pour fermer
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        fermerModal();
    }
});

// bouton sauvegarder
document.getElementById('modal-sauver').addEventListener('click', function() {
    var texte = document.getElementById('modal-texte').value.trim();
    if (texte.length == 0) {
        alert('Le texte ne peut pas être vide');
        return;
    }
    if (texte.length > 500) {
        alert('Texte trop long (500 caractères maximum)');
        return;
    }

    if (actionModal == 'creer') {
        creerPostit(texte, coordX, coordY);
    } else if (actionModal == 'modifier') {
        modifierPostit(idPostitModal, texte);
    }
    fermerModal();
});

// double-clic sur le tableau pour créer un postit
tableau.addEventListener('dblclick', function(e) {
    if (!CURRENT_USER) {
        alert('Vous devez être connecté pour créer un post-it');
        return;
    }
    if (!CURRENT_USER.can_create) {
        alert('Vous n\'avez pas la permission de créer des post-its');
        return;
    }
    // ne pas déclencher sur les boutons
    if (e.target.classList.contains('btn-icone')) return;
    if (e.target.closest && e.target.closest('.postit')) return;

    var rect = tableau.getBoundingClientRect();
    coordX = e.clientX - rect.left - 100;
    coordY = e.clientY - rect.top - 50;
    if (coordX < 0) coordX = 0;
    if (coordY < 0) coordY = 0;

    ouvrirModal('creer', null, '');
});

// double-tap sur mobile pour créer un postit
tableau.addEventListener('touchend', function(e) {
    if (!CURRENT_USER || !CURRENT_USER.can_create) return;
    if (e.target.closest && e.target.closest('.postit')) return;
    if (e.changedTouches.length != 1) return;

    var maintenant = Date.now();
    var touch = e.changedTouches[0];
    var rect = tableau.getBoundingClientRect();
    var tx = touch.clientX - rect.left;
    var ty = touch.clientY - rect.top;

    var delai = maintenant - lastTap;
    var dx = Math.abs(tx - lastTapX);
    var dy = Math.abs(ty - lastTapY);

    lastTap = maintenant;
    lastTapX = tx;
    lastTapY = ty;

    // double tap = deux taps en moins de 300ms au même endroit
    if (delai > 0 && delai < 300 && dx < 20 && dy < 20) {
        coordX = tx - 100;
        coordY = ty - 50;
        if (coordX < 0) coordX = 0;
        if (coordY < 0) coordY = 0;
        ouvrirModal('creer', null, '');
        e.preventDefault();
    }
}, { passive: false });

// gérer les clics sur les boutons modifier et supprimer
tableau.addEventListener('click', function(e) {
    // bouton supprimer
    if (e.target.classList.contains('btn-supprimer') || e.target.closest('.btn-supprimer')) {
        var btn = e.target.classList.contains('btn-supprimer') ? e.target : e.target.closest('.btn-supprimer');
        var postit = btn.closest('.postit');
        if (!postit) return;
        var id = postit.dataset.id;
        supprimerPostit(id);
        return;
    }
    // bouton modifier
    if (e.target.classList.contains('btn-modifier') || e.target.closest('.btn-modifier')) {
        var btn2 = e.target.classList.contains('btn-modifier') ? e.target : e.target.closest('.btn-modifier');
        var postit2 = btn2.closest('.postit');
        if (!postit2) return;
        var id2 = postit2.dataset.id;
        var texteActuel = postit2.querySelector('.postit-texte').textContent;
        ouvrirModal('modifier', id2, texteActuel);
        return;
    }
});

// créer un postit via AJAX
function creerPostit(texte, x, y) {
    fetch('/ajouter', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': CSRF_TOKEN
        },
        body: JSON.stringify({ texte: texte, x: Math.round(x), y: Math.round(y) })
    })
    .then(function(response) {
        return response.json();
    })
    .then(function(data) {
        if (!data.ok) {
            alert('Erreur: ' + (data.message || 'impossible de créer le postit'));
            return;
        }
        // ajouter le postit dans la page
        ajouterElementPostit(data.postit);
    })
    .catch(function(err) {
        console.log('Erreur réseau:', err);
        alert('Erreur réseau, réessayez');
    });
}

// modifier un postit via AJAX
function modifierPostit(id, texte) {
    fetch('/modifier', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': CSRF_TOKEN
        },
        body: JSON.stringify({ id: id, texte: texte })
    })
    .then(function(response) {
        return response.json();
    })
    .then(function(data) {
        if (!data.ok) {
            alert('Erreur: ' + (data.message || 'impossible de modifier'));
            return;
        }
        // mettre à jour le texte dans la page
        var el = document.querySelector('#postit-' + id + ' .postit-texte');
        if (el) {
            el.textContent = texte;
        }
    })
    .catch(function(err) {
        console.log('Erreur réseau:', err);
        alert('Erreur réseau');
    });
}

// supprimer un postit via AJAX
function supprimerPostit(id) {
    var ok = confirm('Voulez-vous vraiment supprimer ce post-it ?');
    if (!ok) return;

    fetch('/effacer', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': CSRF_TOKEN
        },
        body: JSON.stringify({ id: id })
    })
    .then(function(response) {
        return response.json();
    })
    .then(function(data) {
        if (!data.ok) {
            alert('Erreur: ' + (data.message || 'impossible de supprimer'));
            return;
        }
        // enlever le postit de la page
        var el = document.getElementById('postit-' + id);
        if (el) {
            el.remove();
        }
    })
    .catch(function(err) {
        console.log('Erreur réseau:', err);
        alert('Erreur réseau');
    });
}

// créer l'élément HTML pour un postit et l'ajouter au tableau
function ajouterElementPostit(p) {
    var div = document.createElement('div');
    div.className = 'postit';
    div.id = 'postit-' + p.id;
    div.dataset.id = p.id;
    div.dataset.auteur = p.auteur_id;
    div.style.left = p.x + 'px';
    div.style.top = p.y + 'px';
    div.style.zIndex = p.z_index || 1;

    var header = document.createElement('div');
    header.className = 'postit-header';

    var auteurSpan = document.createElement('span');
    auteurSpan.className = 'postit-auteur';
    auteurSpan.textContent = p.auteur_nom;

    var dateSpan = document.createElement('span');
    dateSpan.className = 'postit-date';
    dateSpan.textContent = new Date(p.created_at).toLocaleDateString('fr-FR');

    header.appendChild(auteurSpan);
    header.appendChild(dateSpan);

    // ajouter les boutons si c'est son postit ou s'il est admin
    if (CURRENT_USER && (CURRENT_USER.id === p.auteur_id || CURRENT_USER.can_admin)) {
        var btnModifier = document.createElement('button');
        btnModifier.className = 'btn-icone btn-modifier';
        btnModifier.title = 'Modifier';
        btnModifier.textContent = '✏️';

        var btnSupprimer = document.createElement('button');
        btnSupprimer.className = 'btn-icone btn-supprimer';
        btnSupprimer.title = 'Supprimer';
        btnSupprimer.textContent = '✖';

        header.appendChild(btnModifier);
        header.appendChild(btnSupprimer);
    }

    var texteDiv = document.createElement('div');
    texteDiv.className = 'postit-texte';
    texteDiv.textContent = p.texte;

    div.appendChild(header);
    div.appendChild(texteDiv);

    tableau.appendChild(div);
    activerDrag(div);
}

// activer le drag and drop sur un postit
function activerDrag(el) {
    var enTrainDeDragger = false;
    var startX = 0;
    var startY = 0;
    var posDepart_left = 0;
    var posDepart_top = 0;

    el.addEventListener('pointerdown', function(e) {
        // pas de drag sur les boutons
        if (e.target.classList.contains('btn-icone')) return;
        if (!CURRENT_USER) return;

        var auteurId = parseInt(el.dataset.auteur);
        // seul le propriétaire ou l'admin peut déplacer
        if (CURRENT_USER.id !== auteurId && !CURRENT_USER.can_admin) return;

        enTrainDeDragger = true;
        el.setPointerCapture(e.pointerId);
        startX = e.clientX;
        startY = e.clientY;
        posDepart_left = parseInt(el.style.left) || 0;
        posDepart_top = parseInt(el.style.top) || 0;
        e.preventDefault();
    });

    el.addEventListener('pointermove', function(e) {
        if (!enTrainDeDragger) return;
        var dx = e.clientX - startX;
        var dy = e.clientY - startY;
        var newLeft = posDepart_left + dx;
        var newTop = posDepart_top + dy;

        if (newLeft < 0) newLeft = 0;
        if (newTop < 0) newTop = 0;

        el.style.left = newLeft + 'px';
        el.style.top = newTop + 'px';
    });

    el.addEventListener('pointerup', function(e) {
        if (!enTrainDeDragger) return;
        enTrainDeDragger = false;

        var id = el.dataset.id;
        var x = parseInt(el.style.left) || 0;
        var y = parseInt(el.style.top) || 0;

        // envoyer la nouvelle position au serveur
        fetch('/deplacer', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': CSRF_TOKEN
            },
            body: JSON.stringify({ id: id, x: x, y: y })
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (!data.ok) {
                console.log('Erreur déplacement');
            }
        })
        .catch(function(err) {
            console.log('Erreur réseau déplacement:', err);
        });
    });

    el.addEventListener('pointercancel', function(e) {
        enTrainDeDragger = false;
    });
}

// activer le drag sur tous les postits déjà présents dans la page
var tousLesPostits = document.querySelectorAll('.postit');
for (var i = 0; i < tousLesPostits.length; i++) {
    activerDrag(tousLesPostits[i]);
}
