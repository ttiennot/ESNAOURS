'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseLine, parseRoster } = require('../src/roster');

const pick = r => r && [r.number, r.first_name, r.last_name, r.position, r.role];

test('formats de lignes reconnus', () => {
  assert.deepEqual(pick(parseLine('Jean Dupont')), [null, 'Jean', 'Dupont', 'MIL', null]);
  assert.deepEqual(pick(parseLine('DUPONT Jean')), [null, 'Jean', 'Dupont', 'MIL', null]);
  assert.deepEqual(pick(parseLine('DE LA TOUR Jean-Marc')), [null, 'Jean-Marc', 'De La Tour', 'MIL', null]);
  assert.deepEqual(pick(parseLine('Dupont, Jean')), [null, 'Jean', 'Dupont', 'MIL', null]);
  assert.deepEqual(pick(parseLine('10 Jean Dupont')), [10, 'Jean', 'Dupont', 'MIL', null]);
  assert.deepEqual(pick(parseLine('1. Kévin Martin - Gardien')), [1, 'Kévin', 'Martin', 'GB', null]);
  assert.deepEqual(pick(parseLine('Paul Durand (Défenseur)')), [null, 'Paul', 'Durand', 'DEF', null]);
  assert.deepEqual(pick(parseLine('Hugo Roux ATT')), [null, 'Hugo', 'Roux', 'ATT', null]);
  assert.deepEqual(pick(parseLine('Philippe Bonnet - Entraîneur')), [null, 'Philippe', 'Bonnet', 'STAFF', 'Entraîneur']);
  assert.deepEqual(pick(parseLine("- jean d'ARC")), [null, 'Jean', "D'Arc", 'MIL', null]);
});

test('un nom de famille qui ressemble à un poste reste un nom', () => {
  // « Avant » ou « Central » seuls ne doivent pas être pris pour un poste s'il ne reste rien
  assert.deepEqual(pick(parseLine('Marc Lemilieu')), [null, 'Marc', 'Lemilieu', 'MIL', null]);
  assert.deepEqual(pick(parseLine('Marc Avant')), [null, 'Marc', 'Avant', 'MIL', null]);
  assert.deepEqual(pick(parseLine('Marc Avant ATT')), [null, 'Marc', 'Avant', 'ATT', null]);
});

test('lignes vides ignorées', () => {
  assert.equal(parseRoster('\n  Jean Dupont \n\n\t\nPaul Martin\n').length, 2);
});
