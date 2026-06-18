import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  buildProfileImageQualitySummary,
  isLikelyPublicProfileImageUrl,
  isNonPersonProfileImageUrl,
  isSharedProfileImageAcrossDifferentNames,
} from '../profileImageQualityAuditCore';
import {
  buildProfileImageQualityAuditOutput,
  parseProfileImageQualityAuditArgs,
  writeProfileImageQualityAuditOutput,
} from '../profileImageQualityAudit';

describe('profileImageQualityAuditCore', () => {
  it('flags badge and metric URLs as non-person images', () => {
    expect(isNonPersonProfileImageUrl('https://badge.dimensions.ai/badge?count=1')).toBe(true);
    expect(isNonPersonProfileImageUrl('https://badges.altmetric.com/?score=1')).toBe(true);
    expect(isLikelyPublicProfileImageUrl('https://badge.dimensions.ai/badge?count=1')).toBe(false);
  });

  it('allows only trusted Yale profile image hosts for public display', () => {
    expect(
      isLikelyPublicProfileImageUrl(
        'https://psychology.yale.edu/sites/default/files/styles/people_thumbnail/public/pictures/ahn.jpg',
      ),
    ).toBe(true);
    expect(
      isLikelyPublicProfileImageUrl(
        'https://ysm-res.cloudinary.com/image/upload/v1/yms/prod/person-headshot',
      ),
    ).toBe(true);
    expect(isLikelyPublicProfileImageUrl('https://yalies.io/images/jdoe24.jpg')).toBe(true);

    expect(isLikelyPublicProfileImageUrl('https://tracker.example.test/pixel.png')).toBe(false);
    expect(isLikelyPublicProfileImageUrl('http://tracker.example.test/pixel.png')).toBe(false);
  });

  it('summarizes duplicate face URLs across different people', () => {
    const summary = buildProfileImageQualitySummary([
      {
        id: 'cleman',
        netid: 'mwc2',
        fname: 'Michael',
        lname: 'Cleman',
        imageUrl: 'https://ysm-res.cloudinary.com/image/upload/v1/yms/prod/same-face',
      },
      {
        id: 'leapman',
        netid: 'lm855',
        fname: 'Michael S.',
        lname: 'Leapman',
        imageUrl: 'https://ysm-res.cloudinary.com/image/upload/v1/yms/prod/same-face',
      },
      {
        id: 'metric',
        netid: 'metric1',
        fname: 'Metric',
        lname: 'Badge',
        imageUrl: 'https://badge.dimensions.ai/badge?count=1',
      },
    ]);

    expect(summary.nonPersonImageCount).toBe(1);
    expect(summary.duplicateImageGroupCount).toBe(1);
    expect(summary.duplicateImages[0]).toMatchObject({
      count: 2,
      distinctNameCount: 2,
    });
    expect(summary.duplicateImages[0].users.map((user) => user.netid)).toEqual(['mwc2', 'lm855']);
  });

  it('detects a public image shared by different named people', () => {
    const leapman = {
      netid: 'lm855',
      fname: 'Michael S.',
      lname: 'Leapman',
      imageUrl: 'https://ysm-res.cloudinary.com/image/upload/v1/yms/prod/same-face',
    };

    expect(
      isSharedProfileImageAcrossDifferentNames(leapman, [
        leapman,
        {
          netid: 'mwc2',
          fname: 'Michael',
          lname: 'Cleman',
          imageUrl: 'https://ysm-res.cloudinary.com/image/upload/v1/yms/prod/same-face',
        },
      ]),
    ).toBe(true);

    expect(
      isSharedProfileImageAcrossDifferentNames(leapman, [
        {
          netid: 'lm855-copy',
          fname: 'Michael S.',
          lname: 'Leapman',
          imageUrl: 'https://ysm-res.cloudinary.com/image/upload/v1/yms/prod/same-face',
        },
      ]),
    ).toBe(false);
  });
});

describe('profileImageQualityAudit CLI helpers', () => {
  it('parses strict, sample-limit, and output flags', () => {
    expect(
      parseProfileImageQualityAuditArgs([
        '--strict',
        '--sample-limit=12',
        '--output',
        '/tmp/ylabs-profile-image-quality.json',
      ]),
    ).toEqual({
      strict: true,
      sampleLimit: 12,
      output: '/tmp/ylabs-profile-image-quality.json',
    });
    expect(() => parseProfileImageQualityAuditArgs(['prod'])).toThrow(
      /Unknown profile image quality audit argument: prod/,
    );
    expect(() => parseProfileImageQualityAuditArgs(['--sample-limit=bad'])).toThrow(
      /--sample-limit requires a non-negative integer/,
    );
    expect(() => parseProfileImageQualityAuditArgs(['--sample-limit=9007199254740992'])).toThrow(
      /--sample-limit requires a non-negative integer/,
    );
    expect(() => parseProfileImageQualityAuditArgs(['--output', '--strict'])).toThrow(
      /--output requires a path/,
    );
    expect(() => parseProfileImageQualityAuditArgs(['--output=--strict'])).toThrow(
      /--output requires a path/,
    );
    expect(() =>
      parseProfileImageQualityAuditArgs(['--output', '/var/tmp/profile-image-quality.json']),
    ).toThrow(/--output must write under/);
    expect(() =>
      parseProfileImageQualityAuditArgs(['--output', '/tmp/profile-image-quality.txt']),
    ).toThrow(/--output must point to a \.json report file/);
  });

  it('writes the profile image quality artifact when output is provided', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-profile-image-quality-'));
    const output = path.join(dir, 'profile-image-quality.json');
    writeProfileImageQualityAuditOutput(
      {
        nonPersonImageCount: 1,
        duplicateImageGroupCount: 0,
      },
      output,
    );

    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toMatchObject({
      nonPersonImageCount: 1,
      duplicateImageGroupCount: 0,
    });
  });

  it('rejects unsafe profile image quality artifact writes', () => {
    expect(() =>
      writeProfileImageQualityAuditOutput(
        { nonPersonImageCount: 1 },
        '/var/tmp/profile-image-quality.json',
      ),
    ).toThrow(/--output must write under/);
  });

  it('wraps profile image quality artifacts with target metadata and parsed options', () => {
    const output = buildProfileImageQualityAuditOutput(
      {
        nonPersonImageCount: 1,
        duplicateImageGroupCount: 0,
      },
      {
        environment: 'beta',
        db: 'Beta',
        options: {
          strict: true,
          sampleLimit: 12,
          output: '/tmp/ylabs-profile-image-quality.json',
        },
      },
    );

    expect(output).toEqual({
      nonPersonImageCount: 1,
      duplicateImageGroupCount: 0,
      environment: 'beta',
      db: 'Beta',
      options: {
        strict: true,
        sampleLimit: 12,
        output: '/tmp/ylabs-profile-image-quality.json',
      },
    });
  });
});
