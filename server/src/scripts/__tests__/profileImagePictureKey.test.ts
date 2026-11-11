import { describe, expect, it } from 'vitest';
import {
  isLikelyPublicProfileImageUrl,
  isSharedProfileImageAcrossDifferentNames,
  profileImagePictureKey,
  profileImagePictureSearchPattern,
} from '../profileImageQualityAuditCore';

const CLOUDINARY_A =
  'https://ysm-res.cloudinary.com/image/upload/c_fill,h_300,w_300/v1700000000/yms/prod/fixture-uuid-1234.jpg';
const CLOUDINARY_B =
  'https://ysm-res.cloudinary.com/image/upload/ar_1:1,c_thumb,g_face,w_120/v1600000000/yms/prod/fixture-uuid-1234.jpg';
const DRUPAL_PICTURE_A =
  'https://fixture.yale.edu/sites/default/files/styles/portrait/public/pictures/picture-4242-1600000000.jpg?itok=abc';
const DRUPAL_PICTURE_B =
  'https://fixture.yale.edu/sites/default/files/pictures/picture-4242-1700000000.jpg';
const DRUPAL_PICTURE_OTHER_DIR =
  'https://fixture.yale.edu/sites/default/files/2019-01/picture-4242-1500000000.jpg';
const DRUPAL_FILE_A =
  'https://fixture.yale.edu/sites/default/files/styles/1_1_300_/public/2024-02/avery-synthetic.jpg?h=1&itok=2';
const DRUPAL_FILE_B = 'https://fixture.yale.edu/sites/default/files/2024-02/avery-synthetic.jpg';

describe('profileImagePictureKey (#5640)', () => {
  it('gives one key to two Cloudinary renditions of one picture', () => {
    expect(profileImagePictureKey(CLOUDINARY_A)).toBe(profileImagePictureKey(CLOUDINARY_B));
  });

  it('gives one key to two uploads of one Drupal user picture in the same directory', () => {
    expect(profileImagePictureKey(DRUPAL_PICTURE_A)).toBe(profileImagePictureKey(DRUPAL_PICTURE_B));
  });

  it('keeps a Drupal user picture in another directory apart, because a site can reuse a uid', () => {
    expect(profileImagePictureKey(DRUPAL_PICTURE_A)).not.toBe(
      profileImagePictureKey(DRUPAL_PICTURE_OTHER_DIR),
    );
  });

  it('gives one key to a Drupal file and its styled rendition', () => {
    expect(profileImagePictureKey(DRUPAL_FILE_A)).toBe(profileImagePictureKey(DRUPAL_FILE_B));
  });

  it('keeps the same picture id on two different hosts apart', () => {
    expect(profileImagePictureKey(DRUPAL_PICTURE_B)).not.toBe(
      profileImagePictureKey(DRUPAL_PICTURE_B.replace('fixture.yale.edu', 'other.yale.edu')),
    );
  });
});

describe('profileImagePictureSearchPattern (#5640)', () => {
  it.each([
    [CLOUDINARY_A, CLOUDINARY_B],
    [DRUPAL_PICTURE_A, DRUPAL_PICTURE_B],
    [DRUPAL_FILE_A, DRUPAL_FILE_B],
  ])('finds the other rendition of %s', (url, variant) => {
    expect(profileImagePictureSearchPattern(url)?.test(variant)).toBe(true);
  });
});

describe('isSharedProfileImageAcrossDifferentNames by picture key (#5640)', () => {
  it('withholds a picture another, differently named, researcher holds under another rendition', () => {
    expect(
      isSharedProfileImageAcrossDifferentNames(
        { fname: 'Avery', lname: 'Synthetic', imageUrl: DRUPAL_PICTURE_A },
        [{ fname: 'Blair', lname: 'Fixture', imageUrl: DRUPAL_PICTURE_B }],
      ),
    ).toBe(true);
  });

  it('keeps a picture only the same name holds', () => {
    expect(
      isSharedProfileImageAcrossDifferentNames(
        { fname: 'Avery', lname: 'Synthetic', imageUrl: CLOUDINARY_A },
        [{ fname: 'Avery', lname: 'Synthetic', imageUrl: CLOUDINARY_B }],
      ),
    ).toBe(false);
  });
});

describe('placeholder images are never served as a person photo (#5640)', () => {
  it.each([
    'https://fixture.yale.edu/sites/default/files/styles/1_1_300_/public/starterkit/yale-motto-carving-detail_fixture.jpg',
    'https://fixture.yale.edu/sites/default/files/styles/portrait/public/2023-01/no-image-available_0.png',
    'https://fixture.yale.edu/sites/default/files/styles/people_detail/public/default_images/facultyblank.jpg',
    'https://fixture.yale.edu/sites/default/files/styles/1_1_300_/public/2023-01/blank-profile-picture-973460_1280.png',
    'https://fixture.yale.edu/wp-content/uploads/2022/01/placeholder-300x300.jpg',
    'https://fixture.yale.edu/sites/default/files/2023-01/Campus_2023_3000x2000.jpg',
    'https://fixture.yale.edu/sites/default/files/styles/portrait/public/2023-01/center-logo-profile_0.jpg',
  ])('refuses %s', (url) => {
    expect(isLikelyPublicProfileImageUrl(url)).toBe(false);
  });

  it.each([
    'https://fixture.yale.edu/sites/default/files/2024-02/avery-blankenship.jpg',
    'https://fixture.yale.edu/sites/default/files/2024-02/campusano-avery.jpg',
    CLOUDINARY_A,
  ])('keeps the real photo %s', (url) => {
    expect(isLikelyPublicProfileImageUrl(url)).toBe(true);
  });
});
